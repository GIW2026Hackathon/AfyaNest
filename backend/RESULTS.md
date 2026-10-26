# Results measured in this repository (simulation only)

All numbers come from the built-in simulator, on houses the models never saw in training.
They prove the pipeline and control logic work; they are **not** field results.

## Forecasting ammonia (gradient-boosting baseline, test houses)

| Horizon | Model error (MAE, ppm) | "Stays the same" guess | Improvement |
|---|---|---|---|
| 1 h | 1.27 | 2.45 | 48 % |
| 3 h | 1.92 | 4.62 | 58 % |
| 6 h | 2.82 | 6.74 | 58 % |

* Early warning: caught 71 % of cases where ammonia crossed 20 ppm within the next 6 h
  (while still below 20 ppm now), with a 0.03 % false-alarm rate on calm periods.
* 10–90 % forecast band contained the true value 73 % of the time (target 80 %).

AmmoniaNet (the graph transformer) is trained in Colab; its numbers land in
`models/ammonianet.json` and it must beat the table above to be worth deploying.

## Closed-loop test: farmer alone vs farmer following AirNest advice

6 simulated houses, days 14-42, identical weather, flocks and events in both runs.

| Measure (bird zones) | Farmer alone | With AirNest | Change |
|---|---|---|---|
| Hours above 25 ppm, per house | 157.5 | 25.9 | **-84 %** |
| Mean ammonia | 29.4 ppm | 9.9 ppm | -66 % |
| Cold stress (degree-hours below comfort) | 863 | 693 | -20 % |
| Fan hours, per house (fan houses only use it) | 42 | 109 | +67 h |

The advice cut ammonia exposure without making birds colder, because it times short
airing bursts and fan use instead of simply opening curtains all night.
Caveats: the simulator's worst houses reach unrealistic peaks, the AI was given a
perfect weather forecast, and the farmer was assumed to follow every hourly advice.
Real-world gains will be smaller; measure them in your pilot.
