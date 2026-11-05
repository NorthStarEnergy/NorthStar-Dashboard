# Meet the table

Five fictional regulars share one mixed-strategy practice baseline. Portraits are original local SVG illustrations. Each player has a main tendency and a few smaller secondary tendencies; nobody is a pure calling station, maniac or automatic folder.

- **Maya Chen — Patient collector.** Flats a little more instead of three-betting, adds a few slowplays, and defends suited hands a touch wider.
- **Owen Reed — Position challenger.** Opens slightly wider from early position and the blinds, applies a little extra draw pressure, and prefers slightly larger sizes.
- **Elise Park — Careful defender.** Folds a few more marginal bluff-catchers, is a little more cautious on the river, and occasionally traps strong hands.
- **Leo Silva — Pressure player.** Takes a few more betting opportunities, follows through with slightly more second barrels, and value-bets a touch thinner.
- **Nora Vale — Value first.** Bluffs slightly less without eliminating bluffs, looks for a little more thin value, and checks some draws more often.

## Shared decisions

Preflop uses hand quality, position, raise depth and size, limpers, price and remaining stack commitment. Premium hands mix reraises and calls; selected suited wheel aces can bluff-reraise without having to qualify for a flatting range.

Postflop uses likelihood-weighted legal opponent combinations, public betting history, board texture, personal made hands, draws, relevant ace blockers, position, initiative, approximate equity realization, contestable pot odds and stack-to-pot context. Value and bluff portions use shared sizing families. Strong hands retain some checks/calls; draws and selected low-showdown hands retain some bets/raises. Multiway bluffing is reduced.

## Keeping traits subtle

Twelve frozen trait values are defined in `poker_study/personalities.py`. Combined personality effects are capped at 0.10 total variation between fold/call/check/raise probabilities versus the neutral baseline. Thus an individual action category cannot shift by more than ten percentage points in a single decision due to personality. Size preferences are small separate adjustments. These are consistent tendencies, not guarantees about any one hand.

The hero receives neutral hints. Solver-imported rows are applied exactly, without personality changes. The bots cannot inspect actual opponent hole cards or future deck cards. Their ranges and mixed frequencies are engineered heuristics, not a solved six-max GTO strategy.


Cash-table visitors: Jules Hart (patient preflop, active draws), Sam Rivera (slightly wider defense, river caution), and Alex Morgan (selective early aggression, fewer bluffs). All use the same bounded trait system. About 12% of hands replace one seated bot between hands; busted bots always leave. Newcomers buy in for 100 BB.
