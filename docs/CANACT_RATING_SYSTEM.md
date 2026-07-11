# CANACT Rating System — Complete Weightage Reference

> **Status:** Design Reference | **Date:** 2026-07-09 | **No code changes made**
>
> Every rateable action in CANACT, its exact score contribution, and the math behind it.
> Stories and Rate Me are excluded per spec.

---

## 0. Universal Functions

All score components sit on a baseline of **700 points**, clamped to $[250, 950]$.

### 0.1 Confidence Curve

$$
\boxed{\gamma(n, N) = \frac{\ln(1 + n)}{\ln(1 + N)},\quad \gamma \in [0, 1]}
$$

| $n$ | $\gamma(n,20)$ | $\gamma(n,16)$ | $\gamma(n,30)$ |
|---|---|---|---|
| 1 | 0.228 | 0.245 | 0.202 |
| 3 | 0.455 | 0.489 | 0.404 |
| 5 | 0.589 | 0.632 | 0.522 |
| 10 | 0.788 | 0.846 | 0.698 |
| 20 | 1.000 | — | 0.887 |
| 30 | — | — | 1.000 |
| 16 | — | 1.000 | — |

---

## 1. Proximity Encounter Rating (T1)

**Trigger:** GPS-verified co-location $\geq 45\text{s}$ within $\sim 50\text{m}$. On departure, rate the person: 👍 or 👎.

**Formula:**

$$
\sigma_p = \frac{L - D}{\max(1, L+D)},\qquad
A_p = \begin{cases}
\sigma_p \cdot 55 \cdot \gamma(L+D,\;20), & \sigma_p \geq 0 \\
\sigma_p \cdot 120 \cdot \gamma(L+D,\;20), & \sigma_p < 0
\end{cases}
$$

**Range:** $[-120, +55]$

### 1.1 Exact Marginal Weightage — 👍 LIKE

| Like # | Cumulative $A_p$ | **This Like Adds** | Notes |
|---|---|---|---|
| 1st | +12.52 | **+12.52** | First ever like — low confidence |
| 2nd | +19.85 | +7.32 | — |
| 3rd | +25.04 | +5.20 | — |
| 5th | +32.37 | +3.29 | — |
| 10th | +43.32 | +1.72 | — |
| 15th | +50.09 | +1.17 | — |
| 20th | +55.00 | +0.88 | At saturation |
| 21st+ | +55.00 | **0.00** | CAPPED — no further gain |

### 1.2 Exact Marginal Weightage — 👎 DISLIKE

| Dislike # | Cumulative $A_p$ | **This Dislike Costs** | Notes |
|---|---|---|---|
| 1st | −27.32 | **−27.32** | First dislike hits hard |
| 2nd | −43.30 | −15.98 | — |
| 3rd | −54.64 | −11.34 | — |
| 5th | −70.62 | −7.19 | — |
| 10th | −94.51 | −3.76 | — |
| 15th | −109.28 | −2.54 | — |
| 20th | −120.00 | −1.92 | At saturation |
| 21st+ | −120.00 | **0.00** | CAPPED |

### 1.3 Mixed Profile — Marginal Impact

| State ($L, D$) | $\sigma_p$ | $A_p$ | **+1 Like →** | **+1 Dislike →** |
|---|---|---|---|---|
| (1, 0) | +1.00 | +12.52 | +19.85 (Δ **+7.32**) | 0.00 (Δ **−12.52**) |
| (2, 0) | +1.00 | +19.85 | +25.04 (Δ **+5.20**) | +8.35 (Δ **−11.50**) |
| (5, 0) | +1.00 | +32.37 | +35.15 (Δ **+2.78**) | +26.34 (Δ **−6.03**) |
| (2, 1) | +0.333 | +8.35 | +14.54 (Δ **+6.19**) | 0.00 (Δ **−8.35**) |
| (5, 2) | +0.429 | +16.10 | +19.85 (Δ **+3.75**) | +9.92 (Δ **−6.18**) |
| (5, 5) | 0.000 | 0.00 | +3.39 (Δ **+3.39**) | −3.56 (Δ **−3.56**) |
| (10, 5) | +0.333 | +16.70 | +18.52 (Δ **+1.82**) | +12.80 (Δ **−3.90**) |
| (20, 5) | +0.600 | +35.31 | +36.64 (Δ **+1.33**) | +33.22 (Δ **−2.09**) |

**Key insight:** A dislike hurts 2.18× more than a like helps. One dislike needs ~2.2 likes to cancel out.

---

## 2. Attribute Votes (T2)

**Trigger:** Assign one of 6 character traits. 6-hour cooldown per voter. Selecting a positive attribute auto-sets the main vote to "like" (and vice versa).

**Attributes:**
- **Positive:** `behaviour`, `action`, `reliable`
- **Negative:** `rude`, `inactive`, `unreliable`

**Formula:**

$$
\Sigma_+ = \sum_{k \in P} \text{attrs}[k],\quad
\Sigma_- = \sum_{k \in N} \text{attrs}[k],\quad
\sigma_a = \frac{\Sigma_+ - \Sigma_-}{\max(1, \Sigma_+ + \Sigma_-)}
$$

$$
A_a = \begin{cases}
\sigma_a \cdot 65 \cdot \gamma(\Sigma_+ + \Sigma_-,\;16), & \sigma_a \geq 0 \\
\sigma_a \cdot 140 \cdot \gamma(\Sigma_+ + \Sigma_-,\;16), & \sigma_a < 0
\end{cases}
$$

**Range:** $[-140, +65]$

### 2.1 Exact Marginal Weightage — POSITIVE Attribute

| Attr # | Cumulative $A_a$ | **This Attr Adds** |
|---|---|---|
| 1st | +15.90 | **+15.90** |
| 2nd | +25.20 | +9.30 |
| 3rd | +31.80 | +6.60 |
| 5th | +41.10 | +4.18 |
| 8th | +50.39 | +2.83 |
| 10th | +55.02 | +2.19 |
| 12th | +58.84 | +1.86 |
| 16th | +65.00 | +1.39 |
| 17th+ | +65.00 | **0.00** CAPPED |

### 2.2 Exact Marginal Weightage — NEGATIVE Attribute

| Attr # | Cumulative $A_a$ | **This Attr Costs** |
|---|---|---|
| 1st | −34.25 | **−34.25** |
| 2nd | −54.29 | −20.04 |
| 3rd | −68.51 | −14.22 |
| 5th | −88.53 | −9.01 |
| 8th | −108.54 | −6.10 |
| 10th | −118.50 | −4.71 |
| 12th | −126.74 | −4.01 |
| 16th | −140.00 | −3.00 |
| 17th+ | −140.00 | **0.00** CAPPED |

### 2.3 Per-Attribute Individual Weight (Mixed Profile)

| State ($\Sigma_+, \Sigma_-$) | $\sigma_a$ | $A_a$ | **+1 Positive →** | **+1 Negative →** |
|---|---|---|---|---|
| (1, 0) | +1.00 | +15.90 | +25.20 (Δ **+9.30**) | 0.00 (Δ **−15.90**) |
| (3, 0) | +1.00 | +31.80 | +36.93 (Δ **+5.13**) | +25.60 (Δ **−6.20**) |
| (5, 0) | +1.00 | +41.10 | +45.29 (Δ **+4.18**) | +35.93 (Δ **−5.17**) |
| (1, 1) | 0.00 | 0.00 | +7.52 (Δ **+7.52**) | −10.08 (Δ **−10.08**) |
| (3, 2) | +0.200 | +6.47 | +12.46 (Δ **+5.99**) | +0.58 (Δ **−5.89**) |
| (5, 5) | 0.000 | 0.00 | +3.54 (Δ **+3.54**) | −5.07 (Δ **−5.07**) |

**Asymmetry:** $\frac{140}{65} = 2.15\!:\!1$. Character flaws hurt more than virtues help.

---

## 3. Help Actions (T3)

**Trigger:** Help lifecycle from offer → confirmation → resolution → close judgment.

### 3.1 Help Resolved — Stat-Based

$$
A_h^{\text{resolved}} = \min(45,\; \ln(1 + R) \cdot 18)
$$

| Resolved # | Cumulative | **This Resolve Adds** |
|---|---|---|
| 1st | +12.48 | **+12.48** |
| 2nd | +19.78 | +7.30 |
| 3rd | +24.95 | +5.18 |
| 5th | +32.26 | +3.28 |
| 8th | +37.42 | +2.12 |
| 10th | +43.16 | +1.72 |
| 12th | +44.96 | +0.82 |
| 13th+ | +45.00 | **0.00** CAPPED |

### 3.2 Help Confirmed — Stat-Based

$$
A_h^{\text{confirmed}} = \min(30,\; \ln(1 + C) \cdot 12)
$$

| Confirmed # | Cumulative | **This Confirm Adds** |
|---|---|---|
| 1st | +8.32 | **+8.32** |
| 2nd | +13.18 | +4.87 |
| 3rd | +16.64 | +3.45 |
| 5th | +21.50 | +2.19 |
| 8th | +26.37 | +1.41 |
| 10th | +28.78 | +1.15 |
| 12th | +30.00 | +0.18 |
| 13th+ | +30.00 | **0.00** CAPPED |

### 3.3 Help No-Show — Stat-Based

$$
A_h^{\text{noShow}} = -\min(100,\; \ln(1 + N_s) \cdot 40)
$$

| No-Show # | Cumulative | **This No-Show Costs** |
|---|---|---|
| 1st | −27.73 | **−27.73** |
| 2nd | −43.94 | −16.22 |
| 3rd | −55.45 | −11.51 |
| 5th | −71.67 | −7.29 |
| 8th | −87.95 | −4.82 |
| 10th | −95.92 | −3.81 |
| 13th+ | −100.00 | **0.00** CAPPED |

### 3.4 Help Outcome Judgment — Per-Help (Seeker Decides)

After help closes, the asker picks one of four outcomes. **The helper is NEVER auto-penalised for failure — only the seeker's explicit judgment of bad intent triggers a penalty.**

$$
f(o) = \begin{cases}
+45 \cdot \gamma(H_{\text{yes}},\;10) & o = \text{yes (resolved)} \\
+10 & o = \text{tried-good (genuine effort)} \\
-100 & o = \text{tried-bad (malicious/deceptive)} \\
0 & o = \text{no (neutral close)}
\end{cases}
$$

| Outcome | Per-Instance Score | Confidence Scaling | Max Total |
|---|---|---|---|
| **Yes** (resolved) | +45 per "yes" | $\gamma(H_{\text{yes}}, 10)$ | +45.00 |
| **Tried (good intent)** | **+10** flat | None | Unlimited |
| **Tried (bad intent)** | **−100** flat | None | Unlimited |
| **No** (neutral) | 0 | — | 0 |

**"Yes" outcomes — marginal per judgment:**

| Yes # | Cumulative | **This Yes Adds** |
|---|---|---|
| 1st | +13.01 | **+13.01** |
| 2nd | +20.63 | +7.62 |
| 3rd | +26.02 | +5.39 |
| 5th | +33.62 | +3.39 |
| 8th | +41.24 | +2.17 |
| 10th | +45.00 | +1.79 |
| 11th+ | +45.00 | **0.00** CAPPED |

### 3.5 Help Type Multiplier

$$
\lambda_t = \begin{cases}
1.5 & \text{Red (blood, medical, safety)} \\
1.2 & \text{Orange (important — transport, paperwork)} \\
1.0 & \text{Yellow (everyday — pen, small favour)}
\end{cases}
$$

All positive help components (resolved + confirmed + outcome) are multiplied by $\lambda_t$. No-show penalty is NOT multiplied.

**Example — Red Help, 3 resolved, 2 confirmed, 1 "tried-good":**
$A_h = 1.5 \times (24.95 + 13.18 + 10) + 0 = 1.5 \times 48.13 = \mathbf{+72.20}$

### 3.6 Bilateral Star Rating (Legacy `rating` Field)

After help closes, both parties rate 1–5 stars. Updates the 0–5 `rating` field:

$$
\bar{r}_{\text{new}} = \frac{\bar{r}_{\text{old}} \cdot n + r_{\text{new}}}{n + 1}
$$

| Stars Given | Effect on `rating` field | Side effect on CANACT |
|---|---|---|
| 5 ★ | Updates running average | `likesCount += 1` |
| 4 ★ | Updates running average | `likesCount += 1` |
| 3 ★ | Updates running average | No side effect |
| 2 ★ | Updates running average | `dislikesCount += 1` |
| 1 ★ | Updates running average | `dislikesCount += 1` |

The `likesCount`/`dislikesCount` increments flow into the T1 proximity formula (see §1).

---

## 4. Content Reactions (T4)

**Trigger:** Likes/dislikes/comments on WHA posts and polls. Currently do NOT flow to CANACT score — this is the proposed spec.

### 4.1 Post/Poll Author — Reaction Weightage

$$
\sigma_c = \frac{C_L - C_D}{\max(1, C_L + C_D)},\qquad
A_c^{\text{author}} = \begin{cases}
\sigma_c \cdot 40 \cdot \gamma(C_L + C_D,\;30), & \sigma_c \geq 0 \\
\sigma_c \cdot 60 \cdot \gamma(C_L + C_D,\;30), & \sigma_c < 0
\end{cases}
$$

**Range:** $[-60, +40]$

#### LIKE on My Post/Poll — Marginal per reaction

| Reaction # | Cumulative $A_c$ | **This Like Adds** |
|---|---|---|
| 1st | +8.07 | **+8.07** |
| 3rd | +16.15 | +3.35 |
| 5th | +20.87 | +2.12 |
| 10th | +27.93 | +1.11 |
| 20th | +35.46 | +0.57 |
| 30th | +40.00 | +0.38 |
| 31st+ | +40.00 | **0.00** CAPPED |

#### DISLIKE on My Post/Poll — Marginal per reaction

| Reaction # | Cumulative $A_c$ | **This Dislike Costs** |
|---|---|---|
| 1st | −12.11 | **−12.11** |
| 3rd | −24.22 | −5.03 |
| 5th | −31.31 | −3.19 |
| 10th | −41.90 | −1.67 |
| 20th | −53.19 | −0.85 |
| 30th | −60.00 | −0.57 |
| 31st+ | −60.00 | **0.00** CAPPED |

#### Mixed Content Profile — Marginal

| State ($C_L, C_D$) | $\sigma_c$ | $A_c$ | **+1 Like →** | **+1 Dislike →** |
|---|---|---|---|---|
| (1, 0) | +1.00 | +8.07 | +14.31 (Δ **+6.23**) | 0.00 (Δ **−8.07**) |
| (5, 0) | +1.00 | +20.87 | +22.47 (Δ **+1.60**) | +17.63 (Δ **−3.24**) |
| (10, 0) | +1.00 | +27.93 | +28.85 (Δ **+0.92**) | +26.10 (Δ **−1.83**) |
| (1, 1) | 0.00 | 0.00 | +4.04 (Δ **+4.04**) | −6.06 (Δ **−6.06**) |
| (5, 3) | +0.250 | +6.79 | +9.34 (Δ **+2.55**) | +4.68 (Δ **−2.11**) |
| (10, 5) | +0.333 | +9.32 | +10.71 (Δ **+1.39**) | +7.82 (Δ **−1.50**) |
| (5, 10) | −0.333 | −11.63 | −9.94 (Δ **+1.69**) | −13.01 (Δ **−1.38**) |

**Asymmetry:** $\frac{60}{40} = 1.50\!:\!1$.

### 4.2 Comment on Post/Poll — Author Benefit

A comment on your post/poll counts as **+1 like equivalent** in $C_L$ for the author. So a comment adds the same as a like (see §4.1).

### 4.3 Comment on Post/Poll — Voter Benefit

Each unique interaction (like, dislike, vote, comment) on someone else's poll gives the voter:

| Action | Voter Earns | Daily Cap |
|---|---|---|
| Like on any poll/post | +0.50 | — |
| Dislike on any poll/post | +0.50 | — |
| Vote on poll option | +0.50 | — |
| Comment on poll/post | +0.50 | — |
| **Total from all interactions** | — | **+10.00/day** |

### 4.4 Distinction: Post Like vs Poll Like

| Reaction Type | Author Gets | Voter Gets |
|---|---|---|
| **WHA Post — Like** (cool/love/wow) | Counts as +1 $C_L$ | +0.50 engagement |
| **WHA Post — Sad/Angry** | Counts as +1 $C_D$ (negative) | +0.50 engagement |
| **Poll — Like** | Counts as +1 $C_L$ | +0.50 engagement |
| **Poll — Dislike** | Counts as +1 $C_D$ | +0.50 engagement |
| **Poll — Vote on option** | Counts as +1 $C_L$ | +0.50 engagement |
| **Poll — Comment** | Counts as +1 $C_L$ | +0.50 engagement |
| **WHA Post — Comment** | Counts as +1 $C_L$ | +0.50 engagement |

---

## 5. Cards (T5)

**Trigger:** Any user gives one of 7 cards. Each card type is once per user pair. Cards can be taken back (reverses the increment). All are positive-only.

**Cards:** Understanding, Humour, Good Vibes, Confidence, Intelligence, Creativity, Daring.

$$
A_{\text{cards}} = \min(25,\; \ln(1 + T) \cdot 10),\quad T = \sum \text{cardsReceived}[k]
$$

**Range:** $[0, +25]$

### 5.1 Exact Marginal Weightage — Per Card Received

| Card # | Cumulative | **This Card Adds** |
|---|---|---|
| 1st | +6.93 | **+6.93** |
| 2nd | +10.99 | +4.05 |
| 3rd | +13.86 | +2.88 |
| 5th | +17.92 | +1.82 |
| 8th | +21.97 | +1.18 |
| 10th | +23.98 | +0.94 |
| 12th | +25.00 | +0.15 |
| 13th+ | +25.00 | **0.00** CAPPED |

### 5.2 Per-Card-When-Taken-Back

Taking back a card reverses its contribution. If card #5 is taken back, the score drops by the marginal of that card's position (~1.82 points at position 5). This cascades — subsequent cards "renumber" so the marginal shifts.

---

## 6. Verification & Badges

$$
A_v = \mathbb{1}[\text{profileVerified}] \cdot 15 \;+\; \min(10,\; |\text{badges} \setminus \{\text{verified}\}| \cdot 2)
$$

**Range:** $[0, +25]$

| Action | Exact Score |
|---|---|
| Profile photo verified (10 contacts + 5 vicinity) | **+15.00** flat |
| KYC completed (DigiLocker) | **+15.00** (via badge) |
| Each non-verification badge earned | **+2.00** flat |
| Max from badges (excluding verified) | **+10.00** (5 badges) |
| Max total $A_v$ | **+25.00** |

---

## 7. Underground Mode

Applied to legacy `rating` field (0–5). Transitive to CANACT via `likesCount`/`dislikesCount`.

$$
\Delta U = -\min(0.40,\; 0.05 \cdot n_{\text{today}})
$$

| Occurrence Today | Penalty on `rating` |
|---|---|
| 1st | **−0.05** |
| 2nd | **−0.10** |
| 3rd | **−0.20** |
| 4th | **−0.40** |
| 5th+ | **−0.40** (capped) |

Resets at midnight.

---

## 8. Master Weightage Table (All Actions)

SORTED by trust signal strength: **T1 > T2 > T3 > T4 > T5**

| # | Action | Target | First Instance | 5th Instance | At Saturation | Max Cap | Tier |
|---|---|---|---|---|---|---|---|
| 1 | **Proximity 👍 Like** | Rated user | **+12.52** | +3.29 | +0.88 | +55.00 | T1 |
| 2 | **Proximity 👎 Dislike** | Rated user | **−27.32** | −7.19 | −1.92 | −120.00 | T1 |
| 3 | **Attribute: behaviour (+)**, action (+), reliable (+) | Rated user | **+15.90** | +4.18 | +1.39 | +65.00 | T2 |
| 4 | **Attribute: rude (−)**, inactive (−), unreliable (−) | Rated user | **−34.25** | −9.01 | −3.00 | −140.00 | T2 |
| 5 | **Help: Resolved** | Helper | **+12.48** | +3.28 | 0.00 (at 13) | +45.00 | T3 |
| 6 | **Help: Confirmed** | Helper | **+8.32** | +2.19 | 0.00 (at 12) | +30.00 | T3 |
| 7 | **Help: No-Show** | Helper | **−27.73** | −7.29 | 0.00 (at 13) | −100.00 | T3 |
| 8 | **Help Outcome: Yes** | Helper | **+13.01** | +3.39 | 0.00 (at 10) | +45.00 | T3 |
| 9 | **Help Outcome: Tried-Good** | Helper | **+10.00** | +10.00 | +10.00 | None | T3 |
| 10 | **Help Outcome: Tried-Bad** | Helper | **−100.00** | −100.00 | −100.00 | None | T3 |
| 11 | **Help Outcome: No** | Helper | **0.00** | 0.00 | 0.00 | 0.00 | T3 |
| 12 | **Help Type Multiplier** | Helper | 1.0–1.5× on positives | — | — | ×1.5 | T3 |
| 13 | **Help 5★ / 4★ Rating** | Rated user | `likesCount += 1` → flows into T1 | — | — | — | T3 |
| 14 | **Help 2★ / 1★ Rating** | Rated user | `dislikesCount += 1` → flows into T1 | — | — | — | T3 |
| 15 | **Post/Poll 👍 Like** | Author | **+8.07** | +2.12 | +0.38 | +40.00 | T4 |
| 16 | **Post/Poll 👎 Dislike** | Author | **−12.11** | −3.19 | −0.57 | −60.00 | T4 |
| 17 | **Comment on Post/Poll** | Author | **+8.07** (same as like) | same | same | +40.00 | T4 |
| 18 | **Engage with Poll (like/vote/comment)** | Voter | **+0.50** | +0.50 | +0.50 | +10.00/day | T4 |
| 19 | **Card: Understanding** | Receiver | **+6.93** (as 1st card) | varies | 0.00 (at 13) | +25.00 all | T5 |
| 20 | **Card: Humour** | Receiver | same as above | — | — | — | T5 |
| 21 | **Card: Good Vibes** | Receiver | same | — | — | — | T5 |
| 22 | **Card: Confidence** | Receiver | same | — | — | — | T5 |
| 23 | **Card: Intelligence** | Receiver | same | — | — | — | T5 |
| 24 | **Card: Creativity** | Receiver | same | — | — | — | T5 |
| 25 | **Card: Daring** | Receiver | same | — | — | — | T5 |
| 26 | **Take Back Card** | Receiver | Reverses card's marginal | — | — | — | T5 |
| 27 | **Profile Photo Verified** | Self | **+15.00** | — | — | +15.00 | T5 |
| 28 | **KYC Completed** | Self | **+15.00** | — | — | +15.00 | T5 |
| 29 | **Earn Badge** | Self | **+2.00** each | — | — | +10.00 | T5 |
| 30 | **Go Underground (1st/day)** | Self | −0.05 on rating | — | — | −0.40/day | — |
| 31 | **Go Underground (4th/day)** | Self | −0.40 on rating | — | — | −0.40/day | — |

### 8.1 Quick-Reference: What Each Person Gets

| You do this... | Effect on YOU | Effect on THEM |
|---|---|---|
| 👍 Like someone (proximity) | Nothing | They get +12.52 (1st like, decays) |
| 👎 Dislike someone (proximity) | Nothing | They get −27.32 (1st dislike, decays) |
| Assign +attribute to someone | Auto-likes them (no extra) | They get +15.90 (1st attr, decays) |
| Assign −attribute to someone | Auto-dislikes them | They get −34.25 (1st attr, decays) |
| Give a card to someone | Nothing | They get +6.93 (1st card, decays) |
| Take back a card | Nothing | They lose card's marginal |
| Offer help to someone | `helpStats.offered += 1` (no score) | Nothing |
| Get confirmed as helper | `helpStats.confirmed += 1` → +8.32 | Nothing (asker gets help) |
| Help resolved successfully | `helpStats.resolved += 1` → +12.48 | — |
| No-show on help | `helpStats.noShow += 1` → −27.73 | — |
| Get "tried-good" judgment | +10.00 flat | — |
| Get "tried-bad" judgment | −100.00 flat | — |
| Rate helper 5★ | Nothing | They get `likesCount += 1` → T1 |
| Rate helper 1★ | Nothing | They get `dislikesCount += 1` → T1 |
| Like someone's post | **+0.50** engagement (capped) | They get post like → T4 |
| Dislike someone's post | **+0.50** engagement (capped) | They get post dislike → T4 |
| Comment on someone's post | **+0.50** engagement (capped) | They get +1 like-equivalent → T4 |
| Vote on someone's poll | **+0.50** engagement (capped) | They get +1 like-equivalent → T4 |
| Verify your profile photo | **+15.00** | Nothing |
| Complete KYC | **+15.00** | Nothing |
| Go underground (1st/day) | −0.05 on 0–5 rating | Nothing |

---

## 9. Confidence Decay Reference

Why does the 5th like add less than the 1st? Because $\gamma(n,N)$ saturates:

| $n$ | $\gamma$ (N=20) | Weight of Nth vote |
|---|---|---|
| 1 | 22.8% | 22.8% of max |
| 3 | 45.5% | +11.3% |
| 5 | 58.8% | +5.9% |
| 10 | 78.8% | +3.1% |
| 15 | 91.1% | +1.9% |
| 20 | 100.0% | +1.2% |

Once at saturation ($n \geq N$), additional identical votes add **zero** score. Only changes in the like/dislike *ratio* can move the needle.

---

## 10. Formula Quick-Lookup

| Component | Formula | Range |
|---|---|---|
| Proximity | $\sigma_p \cdot W_p \cdot \gamma(L+D, 20)$, $W_p = 55 \mid 120$ | $[-120, +55]$ |
| Attributes | $\sigma_a \cdot W_a \cdot \gamma(\Sigma, 16)$, $W_a = 65 \mid 140$ | $[-140, +65]$ |
| Help Resolved | $\min(45, \ln(1+R) \cdot 18)$ | $[0, +45]$ |
| Help Confirmed | $\min(30, \ln(1+C) \cdot 12)$ | $[0, +30]$ |
| Help No-Show | $-\min(100, \ln(1+N_s) \cdot 40)$ | $[-100, 0]$ |
| Help Yes | $+45 \cdot \gamma(H_{\text{yes}}, 10)$ per yes | $[0, +45]$ |
| Help Tried-Good | $+10$ flat per instance | $[0, \infty)$ |
| Help Tried-Bad | $-100$ flat per instance | $(-\infty, 0]$ |
| Content Author | $\sigma_c \cdot W_c \cdot \gamma(C_L+C_D, 30)$, $W_c = 40 \mid 60$ | $[-60, +40]$ |
| Content Voter | $+0.50$ per interaction, capped $+10$/day | $[0, +10]$/day |
| Cards | $\min(25, \ln(1+T) \cdot 10)$ | $[0, +25]$ |
| Verification | $15 + \min(10, B \cdot 2)$ | $[0, +25]$ |
| Underground | $-\min(0.40, 0.05 \cdot n_{\text{day}})$ on rating | $[-0.40, 0]$/day |
