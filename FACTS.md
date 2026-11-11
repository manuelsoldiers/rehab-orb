# FACTS — every clinical statement in Rehab Orb, with its source

The app only says or shows what is listed here. The content comes from the `FACTS.md` files of three reels in `short-film-test` (`6mwt-pixel`, `30cst-pixel`, `borg-pixel`), plus the few additions marked **new** below.

**Read this first.** Several primary documents (the ATS 2002 statement on thoracic.org, the CDC STEADI sheet) could not be reached from the production environment, when the reels were made or now. Where a row says *secondary*, the wording was checked on copies and derived protocols only. Check every row against the original, or your centre's protocol, before formal use.

Rehab Orb is decision support for trained professionals. It is not a medical device and it has not been clinically validated.

## 6-Minute Walk Test

Main reference: ATS Committee on Proficiency Standards for Clinical Pulmonary Function Laboratories. *ATS Statement: Guidelines for the Six-Minute Walk Test.* Am J Respir Crit Care Med 2002;166:111–117.

| # | In the app | Source | Checked on |
|---|---|---|---|
| 1 | Flat, straight, hard 30 m corridor, a cone at each turnaround; one lap out and back = 60 m | ATS 2002 | secondary (Frontiers in Physiology 2024 review; derived protocols) |
| 2 | A mark every 3 m | ATS 2002, *Location* | secondary |
| 3 | At least 10 minutes resting in a chair near the start; no warm-up | ATS 2002 | secondary |
| 4 | Baseline pulse, SpO₂, blood pressure, Borg dyspnoea and fatigue; Borg again at the end | ATS 2002 | secondary |
| 5 | Patient instruction "Walk as far as you can in six minutes… slow down, stop and rest, then resume… do not run" | ATS 2002 | secondary; the app labels it a short paraphrase |
| 6 | The tester does not walk alongside and counts the laps | ATS 2002 | secondary |
| 7 | Only the standard phrases, in an even tone; no other encouragement or body language | ATS 2002 | secondary (protocols citing it; ERS phrases table) |
| 8 | **new** The phrases themselves, at 1, 2, 3, 4 and 5 minutes, the warning 15 seconds before the end, and "Stop!" (`src/topics/clinical.js`, `SIXMWT.cues`) | ATS 2002 | **secondary only**: a web search confirmed the cycle of the script and that wording varies between derived protocols. Replace with your centre's exact script if it differs. |
| 9 | Distance = laps × 60 m + the last partial lap | ATS 2002 worksheet | secondary |
| 10 | Stop at once: chest pain, intolerable dyspnoea, leg cramps, staggering, diaphoresis, pale or ashen appearance; then sit the patient down | ATS 2002 | secondary (clinical-trial protocols reproducing it) |
| 11 | Contraindications. Absolute: unstable angina or myocardial infarction in the previous month. Relative: resting heart rate > 120, systolic BP > 180 mmHg, diastolic BP > 100 mmHg | ATS 2002 | **secondary only**, from the list kept in the reel's FACTS for a second episode |
| 12 | **new** Predicted distance. Men: (7.57 × height cm) − (5.02 × age) − (1.76 × weight kg) − 309 m. Women: (2.11 × height cm) − (2.29 × weight kg) − (5.78 × age) + 667 m | Enright PL, Sherrill DL. Am J Respir Crit Care Med 1998;158:1384–7. [doi:10.1164/ajrccm.158.5.9710086](https://doi.org/10.1164/ajrccm.158.5.9710086) | **primary** (abstract read on PubMed) |
| 13 | **new** "The equations explain only about 40% of the variance in healthy adults"; built on healthy adults aged 40 to 80 (the app warns outside that range) | same | primary (abstract) |
| 14 | **new** Learning effect: a second walk averages about 26 m more | Singh SJ et al. Eur Respir J 2014;44:1447–78. [doi:10.1183/09031936.00150414](https://doi.org/10.1183/09031936.00150414) ("pooled mean improvement of 26 m in 13 studies") | primary (abstract) |
| 15 | **new** Two tests should be done | Holland AE et al. Eur Respir J 2014;44:1428–46. [doi:10.1183/09031936.00150314](https://doi.org/10.1183/09031936.00150314) | primary (abstract). Named in the Sources drawer only. |

Left out on purpose:
- **Lower limit of normal** for the Enright & Sherrill equations. The constants could not be confirmed on any source in this session, so the app shows the percentage of predicted only.
- **Minimal important difference** for the walk distance. Not confirmed on a primary source here.

The lap analysis ("lap 4 took 62 s, 17% slower than lap 3") is arithmetic on the lap times the tester entered. The app says so and does not interpret the cause.

## 30-Second Chair Stand

Main references: CDC STEADI, *Assessment: 30-Second Chair Stand* (2017). Rikli RE, Jones CJ. J Aging Phys Act 1999;7:162–181. Jones CJ, Rikli RE, Beam WC. Res Q Exerc Sport 1999;70:113–119, [doi:10.1080/02701367.1999.10608028](https://doi.org/10.1080/02701367.1999.10608028).

| # | In the app | Source | Checked on |
|---|---|---|---|
| 1 | Chair with a straight back, no arm rests, seat about 43 cm (17 in) high | STEADI | secondary (state health department copies of the sheet) |
| 2 | Chair against a wall | Senior Fitness Test / PhenX protocol | secondary |
| 3 | Middle of the seat, feet flat, arms crossed at the wrists against the chest, back straight | STEADI | secondary |
| 4 | Demonstrate, then one to three practice stands | Senior Fitness Test / PhenX. STEADI does not mention a practice trial. | secondary |
| 5 | "On go, rise to a full standing position, then sit back down again. Repeat this for 30 seconds." | STEADI | secondary |
| 6 | Count each full stand; stand next to the patient for safety | STEADI | secondary |
| 7 | More than halfway up at 30 s counts as a stand | STEADI | secondary. Check whether your protocol uses this rule. |
| 8 | Arms used to stand: stop, record 0 | STEADI | secondary |
| 9 | Below-average scores, men / women: 60–64 < 14 / < 12; 65–69 < 12 / < 11; 70–74 < 12 / < 10; 75–79 < 11 / < 10; 80–84 < 10 / < 9; 85–89 < 8 / < 8; 90–94 < 7 / < 4 | STEADI table, from Rikli & Jones 1999 | secondary |
| 10 | "A below average score indicates a risk for falls" | STEADI | secondary |

The sentences "a screening signal to act on, not a diagnosis" and "on its own that does not rule out a risk for falls" are cautions written for the app, not quotations.

## Modified Borg Scale

Main references: Burdon JG et al. Am Rev Respir Dis 1982;126:825–828. ATS 2002 (above). Int J Chron Obstruct Pulmon Dis 2012;7:345–355, [doi:10.2147/COPD.S29571](https://doi.org/10.2147/COPD.S29571). Ries AL. COPD 2005;2:105–110, [doi:10.1081/COPD-200050655](https://doi.org/10.1081/COPD-200050655). Borg GA. Med Sci Sports Exerc 1982;14:377–381.

| # | In the app | Source | Checked on |
|---|---|---|---|
| 1 | The scale: 0 nothing at all · 0.5 very, very slight · 1 very slight · 2 slight · 3 moderate · 4 somewhat severe · 5 severe · 6 · 7 very severe · 8 · 9 very, very severe · 10 maximal | Burdon 1982 as reproduced in ATS 2002 | secondary |
| 2 | Whole or half numbers; numbers and words together | Int J COPD 2012 on Burdon 1982 | primary (full text, PMC3379870) |
| 3 | Rate breathlessness only, not throat or nose | same | primary |
| 4 | Leg fatigue gets its own score; rate before and right after the effort | ATS 2002 | secondary |
| 5 | The scale in sight, the patient points, no hints | Int J COPD 2012 | primary |
| 6 | "Point to the number or words that match your breathing right now." | paraphrase of the standardised instruction | the app labels it a paraphrase |
| 7 | **new** "…match how tired your legs feel right now." | written for the app, by analogy with #6 | **no source**: labelled a paraphrase. Use your centre's wording. |
| 8 | A change of about 1 point can be clinically meaningful in COPD; compare only after the same effort | Ries 2005 | secondary (abstract via search) |
| 9 | Not the 6–20 scale of perceived exertion | Borg 1982 | secondary |

Notes carried over from the reel:
- Versions differ. Some allow a rating above 10. The version here stops at 10 "maximal". Use your centre's validated version.
- The Borg scales are © Gunnar Borg. The app shows a simplified redrawing for teaching. Check licensing (BorgPerception) before using a printed or on-screen scale with patients or commercially.

## Example values

The "Example patient" (man, 72 years, 170 cm, 78 kg) and the two demos (a 392 m walk with a slower fourth lap; 11 stands) are invented and labelled "Demo · simulated patient" on screen.
