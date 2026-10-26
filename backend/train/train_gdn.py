"""Train the Graph Deviation Network anomaly detector and export it to ONNX.

Trains only on normal data (like the GDN paper), calibrates per-channel error
statistics on normal validation data, then reports detection quality on test
houses using the simulator's fault/event labels.
"""
import argparse
import json
import os

from _common import ROOT, ensure_data

import numpy as np
import torch

from airnest.anomaly import GDN_WIN
from airnest.config import F_NODE, G_FEATS, N_NODES
from airnest.dataset import Scaler, split_houses
from airnest.models.gdn import GDN

p = argparse.ArgumentParser()
p.add_argument("--data", default=os.path.join(ROOT, "data/sim.npz"))
p.add_argument("--out", default=os.path.join(ROOT, "models"))
p.add_argument("--epochs", type=int, default=20)
p.add_argument("--steps", type=int, default=300)
p.add_argument("--batch", type=int, default=256)
p.add_argument("--lr", type=float, default=1e-3)
p.add_argument("--topk", type=int, default=8)
a = p.parse_args()

dev = "cuda" if torch.cuda.is_available() else "cpu"
rng = np.random.default_rng(0)
torch.manual_seed(0)
os.makedirs(a.out, exist_ok=True)
x, g, lab = ensure_data(a.data)
tr, va, te = split_houses(len(x))
sp = os.path.join(a.out, "scaler.json")
scaler = Scaler.from_json(sp) if os.path.exists(sp) else Scaler().fit(x[tr], g[tr])
scaler.to_json(sp)
S = N_NODES * F_NODE
xs = scaler.x(x).reshape(len(x), x.shape[1], S)
gs = scaler.g(g)
bad = (lab > 0).reshape(len(x), x.shape[1], S).any(-1)


def starts(houses, normal_only, stride=1):
    out = []
    for h in houses:
        cum = np.concatenate([[0], np.cumsum(bad[h])])
        for t in range(GDN_WIN, x.shape[1], stride):
            if normal_only and cum[t + 1] - cum[t - GDN_WIN] > 0:
                continue
            out.append((h, t))
    return np.array(out)


def tensors(st):
    xw = np.stack([xs[h, t - GDN_WIN:t].T for h, t in st])          # B,S,W
    gn = np.stack([gs[h, t] for h, t in st])
    y = np.stack([xs[h, t] for h, t in st])
    to = lambda v: torch.from_numpy(np.ascontiguousarray(v, np.float32)).to(dev)
    return to(xw), to(gn), to(y)


st_tr, st_va = starts(tr, True), starts(va, True, 3)
model = GDN(S, GDN_WIN, G_FEATS, topk=a.topk).to(dev)
opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)


@torch.no_grad()
def errors(st, bs=2048):
    model.eval()
    out = []
    for i in range(0, len(st), bs):
        xw, gn, y = tensors(st[i:i + bs])
        out.append((model(xw, gn) - y).abs().cpu().numpy())
    return np.concatenate(out)


best = 1e9
for ep in range(a.epochs):
    model.train()
    tot = 0.0
    for _ in range(a.steps):
        xw, gn, y = tensors(st_tr[rng.integers(len(st_tr), size=a.batch)])
        loss = torch.nn.functional.mse_loss(model(xw, gn), y)
        opt.zero_grad()
        loss.backward()
        opt.step()
        tot += loss.item()
    v = float(errors(st_va).mean())
    print(f"epoch {ep + 1:02d} train mse {tot / a.steps:.4f} val mae {v:.4f}")
    if v < best:
        best = v
        torch.save(model.state_dict(), os.path.join(a.out, "gdn.pt"))

model.load_state_dict(torch.load(os.path.join(a.out, "gdn.pt"), map_location=dev))
# calibrate on normal validation data (robust per-channel normalisation, GDN paper)
ev = errors(st_va)
med = np.median(ev, 0)
iqr = np.percentile(ev, 75, 0) - np.percentile(ev, 25, 0)
z = (ev - med) / np.maximum(iqr, 1e-3)
thr = float(np.percentile(z, 99.9))
json.dump({"median": med.tolist(), "iqr": iqr.tolist(), "threshold": thr},
          open(os.path.join(a.out, "gdn_stats.json"), "w"))

# test: channel-level detection against labels
st_te = starts(te, False, 2)
zt = (errors(st_te) - med) / np.maximum(iqr, 1e-3) / thr
yt = np.stack([(lab[h, t] > 0).ravel() for h, t in st_te])
pred = zt >= 1.0
tp, fp, fn = (pred & yt).sum(), (pred & ~yt).sum(), (~pred & yt).sum()
prec, rec = tp / max(tp + fp, 1), tp / max(tp + fn, 1)
res = dict(precision=float(prec), recall=float(rec),
           f1=float(2 * prec * rec / max(prec + rec, 1e-9)), threshold=thr)
print("TEST channel-level:", res)
json.dump(res, open(os.path.join(a.out, "gdn_test.json"), "w"), indent=1)

model = model.cpu().eval()
xw, gn, _ = (t.cpu() for t in tensors(st_te[:2]))
kw = dict(input_names=["x", "g"], output_names=["y"], opset_version=17,
          dynamic_axes={"x": {0: "b"}, "g": {0: "b"}, "y": {0: "b"}})
path = os.path.join(a.out, "gdn.onnx")
try:
    torch.onnx.export(model, (xw, gn), path, dynamo=False, **kw)
except TypeError:
    torch.onnx.export(model, (xw, gn), path, **kw)
print("exported", path)
