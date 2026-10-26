"""Train AmmoniaNet (spatio-temporal graph transformer) and export it to ONNX.

    python train/train_ammonianet.py                       # pre-train on simulation
    python train/train_ammonianet.py --data data/farm.npz \
        --init models/ammonianet.pt --lr 2e-4 --epochs 15  # fine-tune on real farm data

Runs on CPU, but a GPU (free Google Colab T4) makes it ~20x faster.
"""
import argparse
import json
import os
import time

from _common import ROOT, ensure_data

import numpy as np
import torch

from airnest.config import (F_NODE, G_FEATS, H_FUT, L_HIST, N_NODES, NH3, PATCH,
                            QUANTILES, STEPS_PER_HOUR, TARGETS)
from airnest.dataset import Scaler, make_batch, split_houses, window_starts
from airnest.models.ammonianet import AmmoniaNet, pinball_loss
from airnest.simulator import ADJ

p = argparse.ArgumentParser()
p.add_argument("--data", default=os.path.join(ROOT, "data/sim.npz"))
p.add_argument("--out", default=os.path.join(ROOT, "models"))
p.add_argument("--init", default=None, help="checkpoint to fine-tune from")
p.add_argument("--epochs", type=int, default=30)
p.add_argument("--steps", type=int, default=400, help="batches per epoch")
p.add_argument("--batch", type=int, default=128)
p.add_argument("--lr", type=float, default=1e-3)
p.add_argument("--d", type=int, default=64)
p.add_argument("--patience", type=int, default=6)
p.add_argument("--seed", type=int, default=0)
a = p.parse_args()

torch.manual_seed(a.seed)
rng = np.random.default_rng(a.seed)
dev = "cuda" if torch.cuda.is_available() else "cpu"
os.makedirs(a.out, exist_ok=True)

x, g, lab = ensure_data(a.data)
tr, va, te = split_houses(len(x), seed=a.seed)
scaler_path = os.path.join(a.out, "scaler.json")
if a.init and os.path.exists(scaler_path):
    scaler = Scaler.from_json(scaler_path)          # keep the pre-training scaling
else:
    scaler = Scaler().fit(x[tr], g[tr])
    scaler.to_json(scaler_path)
xs, gs = scaler.x(x), scaler.g(g)
st_tr = window_starts(lab, tr, stride=1)
st_va = window_starts(lab, va, stride=6)
st_te = window_starts(lab, te, stride=6)
print(f"device={dev} windows train={len(st_tr)} val={len(st_va)} test={len(st_te)}")

cfg = dict(n_nodes=N_NODES, f_node=F_NODE, g_feats=G_FEATS, L=L_HIST, H=H_FUT,
           patch=PATCH, target_idx=TARGETS, d=a.d, adj_prior=ADJ.tolist())
model = AmmoniaNet(**cfg).to(dev)
if a.init:
    model.load_state_dict(torch.load(a.init, map_location=dev))
print(f"parameters: {sum(t.numel() for t in model.parameters()):,}")
opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=a.epochs * a.steps,
                                            pct_start=0.1)


def tensors(starts):
    xh, gh, gf, y = make_batch(xs, gs, starts)
    raw = scaler.inv_target(y[..., 0], NH3)
    # emphasise dangerous ammonia levels in the loss
    w = np.stack([1 + np.clip(raw, 0, 100) / 20, np.full_like(raw, 0.5)], -1)
    to = lambda v: torch.from_numpy(np.ascontiguousarray(v, dtype=np.float32)).to(dev)
    return to(xh), to(gh), to(gf), to(y), to(w)


@torch.no_grad()
def evaluate(starts, bs=512):
    model.eval()
    losses, preds, ys = [], [], []
    for i in range(0, len(starts), bs):
        xh, gh, gf, y, w = tensors(starts[i:i + bs])
        out = model(xh, gh, gf)
        losses.append(pinball_loss(out, y, QUANTILES, w).item() * len(xh))
        preds.append(out.cpu().numpy())
        ys.append(y.cpu().numpy())
    P, Y = np.concatenate(preds), np.concatenate(ys)
    nh3_p = scaler.inv_target(P[..., 0, :], NH3)
    nh3_y = scaler.inv_target(Y[..., 0], NH3)
    m = {"loss": sum(losses) / len(starts)}
    for hrs in (1, 3, 6):
        k = hrs * STEPS_PER_HOUR - 1
        m[f"mae_{hrs}h_ppm"] = float(np.abs(nh3_p[:, k, :, 1] - nh3_y[:, k]).mean())
    m["coverage_80"] = float(((nh3_y >= nh3_p[..., 0]) & (nh3_y <= nh3_p[..., 2])).mean())
    # persistence baseline ("it stays as it is now") for context
    last = scaler.inv_target(np.stack([xs[h, t - 1, :, NH3] for h, t in starts]), NH3)
    m["persist_mae_3h_ppm"] = float(np.abs(last - nh3_y[:, 3 * STEPS_PER_HOUR - 1]).mean())
    return m


best, bad = 1e9, 0
for ep in range(a.epochs):
    model.train()
    t0, run = time.time(), 0.0
    for _ in range(a.steps):
        idx = rng.integers(len(st_tr), size=a.batch)
        xh, gh, gf, y, w = tensors(st_tr[idx])
        xh = xh + 0.02 * torch.randn_like(xh)              # sensor-noise augmentation
        loss = pinball_loss(model(xh, gh, gf), y, QUANTILES, w)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        run += loss.item()
    m = evaluate(st_va)
    print(f"epoch {ep + 1:02d} train {run / a.steps:.4f} | val " +
          " ".join(f"{k}={v:.3f}" for k, v in m.items()) + f" | {time.time() - t0:.0f}s")
    if m["loss"] < best:
        best, bad = m["loss"], 0
        torch.save(model.state_dict(), os.path.join(a.out, "ammonianet.pt"))
    else:
        bad += 1
        if bad >= a.patience:
            print("early stop")
            break

model.load_state_dict(torch.load(os.path.join(a.out, "ammonianet.pt"), map_location=dev))
test = evaluate(st_te)
print("TEST:", json.dumps(test, indent=1))
json.dump({"config": cfg, "test": test}, open(os.path.join(a.out, "ammonianet.json"), "w"),
          indent=1)

# ---- export to ONNX so the server only needs onnxruntime ----
model = model.cpu().eval()
xh, gh, gf, _, _ = (t.cpu() for t in tensors(st_te[:2]))
onnx_path = os.path.join(a.out, "ammonianet.onnx")
kw = dict(input_names=["xh", "gh", "gf"], output_names=["y"], opset_version=17,
          dynamic_axes={"xh": {0: "b"}, "gh": {0: "b"}, "gf": {0: "b"}, "y": {0: "b"}})
try:
    torch.onnx.export(model, (xh, gh, gf), onnx_path, dynamo=False, **kw)
except TypeError:                                         # older torch without `dynamo`
    torch.onnx.export(model, (xh, gh, gf), onnx_path, **kw)
print("exported", onnx_path)
