_Make sure friend list refreshes when a friend request is sent_
_"" accepted_
_Need to be able to see board and other people's bonus choices_
_Add legend and building costs_
Add terrain? icon tesselation? to hexes
_Can't reject trade_
Need to change trade mechanism
Need to see how many dev cards. Icon can't be the same as normal cards. Need a dev card highlight on closeup
_Should show what you stole_
Should be able to see number under robber
_With victory points, should show 5 (6)_

_Gambler: second roll shouldn't show 'confirm or reroll'_
_Nomad: getting resources even without being on desert. Also need to show roll_
_Curse of decadence: missing city icon is bad_

Notifications for friend requests, game requests, it's your turn, etc

Once no game is left sitting at `initial_placement` `step: 'road'` (check with the query in `.claude/specs/combined-placement-step.md` → "Cleanup, later"), delete the per-piece placement flow: `place_settlement` / `place_road` server-side, `placeRoad` in the store, the `'road'` branches in `PlacementLayer` / `PlacementHeader` / `confirmLabel` / `spectatorStatus`, and `placementDrafting` on the game screen
