# TPO time-profile forecast — prototype results

- Data: 691 RTH sessions, 2023-11-03 → 2026-07-10 (ESU6 5-min)
- Predict the full-day TPO profile from the Initial Balance (first two 30-min periods)
- Walk-forward, k-NN k=25, min history 80 days, scored on 611 days
- Aligned on each day's IB midpoint; scored on a shared ±100pt offset grid

## Leaderboard

```
         EMD_med(pts)  EMD_mean  POCerr_med  VA_IoU_med(%)   JS_med  EMD_skill_vs_persist(%)
method                                                                                      
knn            12.783    15.537      12.000         34.524    0.171                   28.436
persist        17.863    21.153      21.000         15.044    0.302                    0.000
climo          14.006    16.803      13.000         32.000    0.186                   21.590
```

**Best by median EMD: `knn`.** EMD is in ES points — the average 'cost' to slide the predicted profile onto the realized one; POC error is how far the predicted peak lands from the real peak; VA IoU is value-area overlap.

## Read

- If k-NN beats **persist** (yesterday's profile) and **climo** (the average day) on EMD, the IB features carry real shape information.
- Persistence is the honest bar: beating it is the whole game. Climatology says how much a day differs from the average day at all.
- Next: swap the k-NN pool for GEX/DEX-aware features, add a per-day confidence (neighbour distance), and record live so the sample grows.
