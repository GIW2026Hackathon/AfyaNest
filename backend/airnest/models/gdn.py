"""Graph Deviation Network (Deng & Hooi, AAAI 2021) for sensor anomaly detection.

GDN is a leading method for anomaly detection in multivariate IoT sensor data
(water-treatment benchmarks SWaT and WADI). Each sensor channel (6 nodes x 4
channels = 24 here) gets a learned embedding; channels with similar embeddings
are linked (top-k graph); a graph attention layer predicts each channel's next
value from its neighbours. Big, persistent prediction errors = anomaly, and the
channel with the largest error points to the root cause.

Small extension for farms: the house covariates of the next step (curtain, fan,
heater, weather) are injected, so that opening a curtain is not mistaken for an
anomaly.

Input  x [B, S, W]  scaled window of S sensor channels (W past steps)
       g [B, G]     scaled covariates at the predicted step
Output [B, S]       predicted next value per channel (scaled)
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class GDN(nn.Module):
    def __init__(self, n_sensors, win, g_feats, d=64, topk=8, drop=0.1):
        super().__init__()
        self.S, self.k = n_sensors, topk
        self.emb = nn.Parameter(torch.randn(n_sensors, d) * 0.1)
        self.lin = nn.Linear(win, d, bias=False)
        self.att_i = nn.Parameter(torch.randn(2 * d) * 0.1)
        self.att_j = nn.Parameter(torch.randn(2 * d) * 0.1)
        self.gat_bias = nn.Parameter(torch.zeros(d))
        self.norm = nn.LayerNorm(d)
        self.cov = nn.Linear(g_feats, d)
        self.out = nn.Sequential(nn.Linear(d, d), nn.ReLU(), nn.Dropout(drop),
                                 nn.Linear(d, 1))

    def graph(self):
        """Boolean [S,S] mask: each sensor attends to itself and its top-k most
        similar sensors (cosine similarity of embeddings)."""
        e = F.normalize(self.emb, dim=-1)
        sim = e @ e.T
        sim = sim - 2.0 * torch.eye(self.S, device=sim.device)    # exclude self from top-k
        idx = sim.topk(self.k, dim=-1).indices
        mask = torch.zeros(self.S, self.S, dtype=torch.bool, device=sim.device)
        mask.scatter_(1, idx, True)
        return mask | torch.eye(self.S, dtype=torch.bool, device=sim.device)

    def forward(self, x, g):
        B = x.shape[0]
        wx = self.lin(x)                                           # B,S,d
        v = self.emb.unsqueeze(0).expand(B, -1, -1)                # B,S,d
        gcat = torch.cat([v, wx], dim=-1)                          # B,S,2d
        ei = gcat @ self.att_i                                     # B,S
        ej = gcat @ self.att_j                                     # B,S
        e = F.leaky_relu(ei.unsqueeze(2) + ej.unsqueeze(1), 0.2)   # B,S,S
        e = e.masked_fill(~self.graph().unsqueeze(0), float("-inf"))
        a = torch.softmax(e, dim=-1)
        z = F.relu(self.norm(a @ wx + self.gat_bias))              # B,S,d
        z = z * self.emb.unsqueeze(0) + self.cov(g).unsqueeze(1)
        return self.out(z).squeeze(-1)
