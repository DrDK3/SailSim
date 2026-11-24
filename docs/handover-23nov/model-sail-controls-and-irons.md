# Handover investigations (model output)

MODEL OUTPUT from estimated coefficients, not validation.

## Item 16: sail controls, one at a time

| tws | twa | control | stw | vmg | heel | rudder | dStw | dHeel | dRudder |
|---|---|---|---|---|---|---|---|---|---|
| 8 | 45 | default (all 0, lead set) | 4.38 | 2.92 | 2.5 | 0.9 |  |  |  |
| 8 | 45 | kicker 1 | 4.34 | 2.91 | 0.8 | 0.9 | -0.04 | -1.7 | 0 |
| 8 | 45 | cunningham 1 | 4.32 | 2.9 | 1 | 0.8 | -0.06 | -1.5 | -0.1 |
| 8 | 45 | outhaul 1 | 4.31 | 2.88 | 0.5 | 0.6 | -0.07 | -2 | -0.3 |
| 8 | 45 | jibLead -1 | 4.4 | 2.92 | 2.9 | 0.7 | 0.02 | 0.4 | -0.2 |
| 8 | 45 | jibLead 1 | 4.36 | 2.92 | 2.1 | 1 | -0.02 | -0.4 | 0.1 |
| 8 | 90 | default (all 0, lead set) | 5.04 | -0.05 | 0.1 | 1 |  |  |  |
| 8 | 90 | kicker 1 | 4.98 | -0.04 | 0.1 | 1 | -0.06 | 0 | 0 |
| 8 | 90 | cunningham 1 | 4.95 | -0.04 | 0.1 | 0.9 | -0.09 | 0 | -0.1 |
| 8 | 90 | outhaul 1 | 4.92 | -0.04 | 0.1 | 0.9 | -0.12 | 0 | -0.1 |
| 8 | 90 | jibLead -1 | 5.06 | -0.06 | 0.1 | 0.9 | 0.02 | 0 | -0.1 |
| 8 | 90 | jibLead 1 | 5.02 | -0.04 | 0.1 | 1 | -0.02 | 0 | 0 |
| 14 | 45 | default (all 0, lead set) | 5.3 | 3.58 | 23.9 | 3.8 |  |  |  |
| 14 | 45 | kicker 1 | 5.4 | 3.64 | 19.1 | 3.4 | 0.1 | -4.8 | -0.4 |
| 14 | 45 | cunningham 1 | 5.35 | 3.62 | 19.8 | 3.3 | 0.05 | -4.1 | -0.5 |
| 14 | 45 | outhaul 1 | 5.37 | 3.62 | 18.4 | 2.9 | 0.07 | -5.5 | -0.9 |
| 14 | 45 | jibLead -1 | 5.31 | 3.57 | 24.2 | 3.5 | 0.01 | 0.3 | -0.3 |
| 14 | 45 | jibLead 1 | 5.31 | 3.6 | 22.9 | 4 | 0.01 | -1 | 0.2 |
| 14 | 90 | default (all 0, lead set) | 6.34 | 0.08 | 5.5 | 2.9 |  |  |  |
| 14 | 90 | kicker 1 | 6.26 | 0.05 | 2.9 | 2.5 | -0.08 | -2.6 | -0.4 |
| 14 | 90 | cunningham 1 | 6.21 | 0.05 | 3.1 | 2.4 | -0.13 | -2.4 | -0.5 |
| 14 | 90 | outhaul 1 | 6.16 | 0.03 | 2.2 | 2.1 | -0.18 | -3.3 | -0.8 |
| 14 | 90 | jibLead -1 | 6.36 | 0.08 | 6.2 | 3 | 0.02 | 0.7 | 0.1 |
| 14 | 90 | jibLead 1 | 6.31 | 0.09 | 4.9 | 2.9 | -0.03 | -0.6 | 0 |

## Item 17: out of irons

| tws | side | policy | recovered | seconds | twa | stw |
|---|---|---|---|---|---|---|
| 6 | helm to starboard | helm | false | 60 | 11.3 | 0.59 |
| 6 | helm to starboard | helm+ease | false | 60 | 79.5 | 0.19 |
| 6 | helm to starboard | ease, then trim | false | 60 | 63 | 0.76 |
| 6 | helm to port | helm | false | 60 | 11.3 | 0.59 |
| 6 | helm to port | helm+ease | false | 60 | 79.5 | 0.19 |
| 6 | helm to port | ease, then trim | false | 60 | 63 | 0.76 |
| 10 | helm to starboard | helm | false | 60 | 11 | 1.01 |
| 10 | helm to starboard | helm+ease | true | 40.9 | 83.5 |  |
| 10 | helm to starboard | ease, then trim | true | 33.8 | 63.7 |  |
| 10 | helm to port | helm | false | 60 | 11 | 1.01 |
| 10 | helm to port | helm+ease | true | 40.9 | 83.5 |  |
| 10 | helm to port | ease, then trim | true | 33.8 | 63.7 |  |
| 16 | helm to starboard | helm | false | 60 | 23.5 | 1.82 |
| 16 | helm to starboard | helm+ease | true | 15.7 | 50.1 |  |
| 16 | helm to starboard | ease, then trim | true | 15.7 | 50.1 |  |
| 16 | helm to port | helm | false | 60 | 23.5 | 1.82 |
| 16 | helm to port | helm+ease | true | 15.7 | 50.1 |  |
| 16 | helm to port | ease, then trim | true | 15.7 | 50.1 |  |
