"""AmmoniaNet: a spatio-temporal graph transformer for poultry-house air forecasting.

It combines the ideas behind current state-of-the-art forecasters:

* PatchTST (Nie et al., ICLR 2023)      - time is cut into 1-hour patches, so
                                          attention works on meaningful chunks.
* Graph WaveNet / MTGNN (Wu et al.)     - an *adaptive adjacency matrix* learned
                                          from node embeddings captures how air
                                          really moves between sensors, on top of
                                          the physical distance graph.
* STAEformer (Liu et al., CIKM 2023)    - alternating temporal and spatial
                                          attention with learned node embeddings.
* Temporal Fusion Transformer (Lim et al.) - a decoder fed with *known future*
                                          inputs (weather, clock, and the curtain /
                                          fan plan) so we can ask "what if?".
* Quantile outputs (pinball loss)       - 10/50/90% forecasts. The controller plans
                                          against the pessimistic 90% line.

Input  xh [B, L, N, F]  scaled sensor history
       gh [B, L, G]     scaled house covariates history
       gf [B, H, G]     scaled covariates for the forecast window (incl. the plan)
Output [B, H, N, T, Q]  scaled forecasts for T targets (NH3, temp) x Q quantiles
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class _FF(nn.Sequential):
    def __init__(self, d, drop):
        super().__init__(nn.Linear(d, 4 * d), nn.GELU(), nn.Dropout(drop), nn.Linear(4 * d, d))


class EncoderBlock(nn.Module):
    """Temporal self-attention per node, then graph-biased spatial attention."""

    def __init__(self, d, heads, drop):
        super().__init__()
        self.t_attn = nn.MultiheadAttention(d, heads, dropout=drop, batch_first=True)
        self.s_attn = nn.MultiheadAttention(d, heads, dropout=drop, batch_first=True)
        self.n1, self.n2, self.n3 = nn.LayerNorm(d), nn.LayerNorm(d), nn.LayerNorm(d)
        self.ff = _FF(d, drop)
        self.drop = nn.Dropout(drop)

    def forward(self, h, bias):                       # h [B,N,P,D], bias [N,N]
        B, N, P, D = h.shape
        x = h.reshape(B * N, P, D)
        y = self.n1(x)
        x = x + self.drop(self.t_attn(y, y, y, need_weights=False)[0])
        x = x.reshape(B, N, P, D).transpose(1, 2).reshape(B * P, N, D)
        y = self.n2(x)
        x = x + self.drop(self.s_attn(y, y, y, attn_mask=bias.to(y.dtype),
                                      need_weights=False)[0])
        x = x + self.drop(self.ff(self.n3(x)))
        return x.reshape(B, P, N, D).transpose(1, 2)


class DecoderBlock(nn.Module):
    """Future patches attend to each other, to the node's encoded past, then to
    the other nodes (spatial, graph-biased)."""

    def __init__(self, d, heads, drop):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(d, heads, dropout=drop, batch_first=True)
        self.cross = nn.MultiheadAttention(d, heads, dropout=drop, batch_first=True)
        self.s_attn = nn.MultiheadAttention(d, heads, dropout=drop, batch_first=True)
        self.n = nn.ModuleList([nn.LayerNorm(d) for _ in range(4)])
        self.ff = _FF(d, drop)
        self.drop = nn.Dropout(drop)

    def forward(self, q, mem, bias):                  # q [B,N,Hp,D], mem [B,N,Lp,D]
        B, N, Hp, D = q.shape
        x = q.reshape(B * N, Hp, D)
        m = mem.reshape(B * N, mem.shape[2], D)
        y = self.n[0](x)
        x = x + self.drop(self.self_attn(y, y, y, need_weights=False)[0])
        y = self.n[1](x)
        x = x + self.drop(self.cross(y, m, m, need_weights=False)[0])
        x = x.reshape(B, N, Hp, D).transpose(1, 2).reshape(B * Hp, N, D)
        y = self.n[2](x)
        x = x + self.drop(self.s_attn(y, y, y, attn_mask=bias.to(y.dtype),
                                      need_weights=False)[0])
        x = x + self.drop(self.ff(self.n[3](x)))
        return x.reshape(B, Hp, N, D).transpose(1, 2)


class AmmoniaNet(nn.Module):
    def __init__(self, n_nodes, f_node, g_feats, L, H, patch, target_idx,
                 n_q=3, d=64, heads=4, enc_layers=3, dec_layers=2, drop=0.1,
                 emb_dim=16, adj_prior=None):
        super().__init__()
        assert L % patch == 0 and H % patch == 0
        assert n_q == 3, "outputs are (q10, q50, q90)"
        self.N, self.F, self.G, self.L, self.H, self.P = n_nodes, f_node, g_feats, L, H, patch
        self.Lp, self.Hp = L // patch, H // patch
        self.T, self.Q = len(target_idx), n_q
        self.register_buffer("target_idx", torch.tensor(target_idx, dtype=torch.long))

        self.patch_in = nn.Linear(patch * (f_node + g_feats), d)
        self.fut_in = nn.Linear(patch * g_feats, d)
        self.node_emb = nn.Parameter(torch.randn(n_nodes, d) * 0.02)
        self.pos_enc = nn.Parameter(torch.randn(self.Lp, d) * 0.02)
        self.pos_dec = nn.Parameter(torch.randn(self.Hp, d) * 0.02)
        # adaptive graph (Graph WaveNet): A = softmax(relu(E1 E2^T))
        self.e_src = nn.Parameter(torch.randn(n_nodes, emb_dim) * 0.3)
        self.e_dst = nn.Parameter(torch.randn(n_nodes, emb_dim) * 0.3)
        prior = torch.eye(n_nodes) if adj_prior is None else torch.as_tensor(
            adj_prior, dtype=torch.float32) + torch.eye(n_nodes)
        self.register_buffer("adj_prior", prior / prior.sum(1, keepdim=True))

        self.enc = nn.ModuleList([EncoderBlock(d, heads, drop) for _ in range(enc_layers)])
        self.dec = nn.ModuleList([DecoderBlock(d, heads, drop) for _ in range(dec_layers)])
        self.out_norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, patch * self.T * n_q)

    def adjacency(self):
        a = torch.softmax(F.relu(self.e_src @ self.e_dst.T), dim=-1)
        return 0.5 * a + 0.5 * self.adj_prior

    def forward(self, xh, gh, gf):
        B = xh.shape[0]
        N, P, G, Lp, Hp = self.N, self.P, self.G, self.Lp, self.Hp
        bias = torch.log(self.adjacency() + 1e-4)              # [N,N] additive mask

        z = torch.cat([xh, gh.unsqueeze(2).expand(-1, -1, N, -1)], dim=-1)  # B,L,N,F+G
        z = z.reshape(B, Lp, P, N, -1).permute(0, 3, 1, 2, 4).reshape(B, N, Lp, -1)
        h = self.patch_in(z) + self.pos_enc + self.node_emb[:, None]
        for blk in self.enc:
            h = blk(h, bias)

        f = self.fut_in(gf.reshape(B, Hp, P * G))               # B,Hp,D
        q = f.unsqueeze(1) + self.pos_dec + self.node_emb[:, None]   # B,N,Hp,D
        for blk in self.dec:
            q = blk(q, h, bias)

        o = self.head(self.out_norm(q))                          # B,N,Hp,P*T*Q
        o = o.reshape(B, N, Hp, P, self.T, self.Q).reshape(B, N, self.H, self.T, self.Q)
        o = o.permute(0, 2, 1, 3, 4)                             # B,H,N,T,Q

        # residual on the last observed value of each target channel
        last = xh[:, -1][:, :, self.target_idx]                  # B,N,T
        mid = o[..., 1] + last.unsqueeze(1)
        # monotone quantiles: q10 <= q50 <= q90 by construction
        lo = mid - F.softplus(o[..., 0])
        hi = mid + F.softplus(o[..., 2])
        return torch.stack([lo, mid, hi], dim=-1)


def pinball_loss(pred, y, quantiles, weight=None):
    """pred [B,H,N,T,Q], y [B,H,N,T]."""
    q = torch.as_tensor(quantiles, device=pred.device, dtype=pred.dtype)
    e = y.unsqueeze(-1) - pred
    loss = torch.maximum(q * e, (q - 1) * e)
    if weight is not None:
        loss = loss * weight.unsqueeze(-1)
    return loss.mean()
