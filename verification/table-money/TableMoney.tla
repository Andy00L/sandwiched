----------------------------- MODULE TableMoney -----------------------------
\* A guest's chips at one table, step for step as programs/sandwich/src/lib.rs moves them:
\* join, leave, buy_in, cash_out, ante, withdraw_ante, start_round, on_whale_drawn,
\* cancel_draw, settle, abort_round, close_round, evict_seat; the start rule is can_start_round in
\* crates/sandwich-rules/src/draw.rs. Guest "A" is followed; "B" and "C" may or may not play, so a seat can sit out a live round.
\* Each action is one instruction, so one transaction: it lands whole or not at all.
EXTENDS Naturals, FiniteSets

CONSTANTS WithdrawAnteExists, AbortExists, EvictExists, EvictPaysOwner

Players == {"A", "B", "C"}
Others == Players \ {"A"}
ANTE == 1          \* CHIPS_PER_ANTE, one unit here
BUY == 1
START_TOKENS == 1
MIN_PLAYERS == 2   \* sandwich_rules::constants::MIN_PLAYERS

VARIABLES wallet, chips, seated, anted, phase, lobbyTimeUp, roundOver, settleWindowOver, settleWorks, wantsOut

vars == <<wallet, chips, seated, anted, phase, lobbyTimeUp, roundOver, settleWindowOver, settleWorks, wantsOut>>
clocks == <<lobbyTimeUp, roundOver, settleWindowOver, settleWorks>>

Escrow == chips["A"] + chips["B"] + chips["C"] + Cardinality(anted) * ANTE

Init ==
  /\ wallet = [p \in Players |-> START_TOKENS]
  /\ chips = [p \in Players |-> 0]
  /\ seated = [p \in Players |-> FALSE]
  /\ anted = {}
  /\ phase = "lobby"
  /\ lobbyTimeUp = FALSE
  /\ roundOver = FALSE
  /\ settleWindowOver = FALSE
  /\ settleWorks = TRUE
  /\ wantsOut = FALSE

\* join: require!(seat_index.is_none()); a free slot
Join(p) ==
  /\ ~seated[p]
  /\ seated' = [seated EXCEPT ![p] = TRUE]
  /\ UNCHANGED <<wallet, chips, anted, phase, wantsOut>> /\ UNCHANGED clocks
\* leave: require!(!is_anted); require_eq!(chips, 0)
Leave(p) ==
  /\ seated[p] /\ p \notin anted /\ chips[p] = 0
  /\ seated' = [seated EXCEPT ![p] = FALSE]
  /\ UNCHANGED <<wallet, chips, anted, phase, wantsOut>> /\ UNCHANGED clocks
\* buy_in: chips > 0; token transfer wallet -> escrow
BuyIn(p) ==
  /\ wallet[p] >= BUY /\ ~(p = "A" /\ wantsOut)
  /\ wallet' = [wallet EXCEPT ![p] = @ - BUY]
  /\ chips' = [chips EXCEPT ![p] = @ + BUY]
  /\ UNCHANGED <<seated, anted, phase, wantsOut>> /\ UNCHANGED clocks
\* cash_out: require!(!is_seat_anted); chips checked_sub; escrow -> wallet
CashOut(p) ==
  /\ chips[p] > 0 /\ p \notin anted
  /\ wallet' = [wallet EXCEPT ![p] = @ + chips[p]]
  /\ chips' = [chips EXCEPT ![p] = 0]
  /\ UNCHANGED <<seated, anted, phase, wantsOut>> /\ UNCHANGED clocks
\* ante: Lobby; seated; not anted; chips checked_sub CHIPS_PER_ANTE; first ante starts the lobby clock
Ante(p) ==
  /\ phase = "lobby" /\ seated[p] /\ p \notin anted /\ chips[p] >= ANTE /\ ~(p = "A" /\ wantsOut)
  /\ chips' = [chips EXCEPT ![p] = @ - ANTE]
  /\ anted' = anted \cup {p}
  /\ lobbyTimeUp' = (IF anted = {} THEN FALSE ELSE lobbyTimeUp)
  /\ UNCHANGED <<wallet, seated, phase, wantsOut, roundOver, settleWindowOver, settleWorks>>
\* withdraw_ante: Lobby; anted; chips checked_add CHIPS_PER_ANTE; clear the bit
WithdrawAnte(p) ==
  /\ WithdrawAnteExists /\ phase = "lobby" /\ p \in anted
  /\ chips' = [chips EXCEPT ![p] = @ + ANTE]
  /\ anted' = anted \ {p}
  /\ UNCHANGED <<wallet, seated, phase, wantsOut>> /\ UNCHANGED clocks
GuestWantsOut ==
  /\ ~wantsOut /\ wantsOut' = TRUE
  /\ UNCHANGED <<wallet, chips, seated, anted, phase>> /\ UNCHANGED clocks

\* Permissionless instructions and the clock: anyone, the guest included, may send them.
LobbyClockRunsOut ==
  /\ phase = "lobby" /\ anted /= {} /\ ~lobbyTimeUp /\ lobbyTimeUp' = TRUE
  /\ UNCHANGED <<wallet, chips, seated, anted, phase, wantsOut, roundOver, settleWindowOver, settleWorks>>
EveryoneIn == \A p \in Players : seated[p] => p \in anted
\* start_round: can_start_round(anted >= MIN_PLAYERS, everyone in or lobby closed)
StartRound ==
  /\ phase = "lobby" /\ Cardinality(anted) >= MIN_PLAYERS /\ (EveryoneIn \/ lobbyTimeUp)
  /\ phase' = "drawing"
  /\ UNCHANGED <<wallet, chips, seated, anted, wantsOut>> /\ UNCHANGED clocks
\* on_whale_drawn: Drawing -> Live. Whether settle will succeed is unknown at this point:
\* settle can fail for good (round.settle's ChipsNotConserved, a seat that cannot load).
WhaleDrawn ==
  /\ phase = "drawing"
  /\ phase' = "live"
  /\ settleWorks' \in BOOLEAN
  /\ UNCHANGED <<wallet, chips, seated, anted, wantsOut, lobbyTimeUp, roundOver, settleWindowOver>>
\* cancel_draw: Drawing; draw timed out; refund every ante; close_round
CancelDraw ==
  /\ phase = "drawing"
  /\ chips' = [p \in Players |-> (IF p \in anted THEN chips[p] + ANTE ELSE chips[p])]
  /\ anted' = {} /\ phase' = "lobby" /\ lobbyTimeUp' = FALSE
  /\ UNCHANGED <<wallet, seated, wantsOut, roundOver, settleWindowOver, settleWorks>>
RoundTimeRunsOut ==
  /\ phase = "live" /\ ~roundOver /\ roundOver' = TRUE
  /\ UNCHANGED <<wallet, chips, seated, anted, phase, wantsOut, lobbyTimeUp, settleWindowOver, settleWorks>>
SettleWindowRunsOut ==
  /\ phase = "live" /\ roundOver /\ ~settleWindowOver /\ settleWindowOver' = TRUE
  /\ UNCHANGED <<wallet, chips, seated, anted, phase, wantsOut, lobbyTimeUp, roundOver, settleWorks>>
\* settle: Live; now >= end_tick; pot to the winners, conserved; close_round
Settle ==
  /\ phase = "live" /\ roundOver /\ settleWorks
  /\ (\E winner \in anted :
        chips' = [p \in Players |-> (IF p = winner THEN chips[p] + Cardinality(anted) * ANTE ELSE chips[p])])
  /\ anted' = {} /\ phase' = "lobby"
  /\ lobbyTimeUp' = FALSE /\ roundOver' = FALSE /\ settleWindowOver' = FALSE /\ settleWorks' = TRUE
  /\ UNCHANGED <<wallet, seated, wantsOut>>
\* abort_round: Live; now >= end_tick + SETTLE_WINDOW_TICKS; refund every ante; close_round
AbortRound ==
  /\ AbortExists /\ phase = "live" /\ settleWindowOver
  /\ chips' = [p \in Players |-> (IF p \in anted THEN chips[p] + ANTE ELSE chips[p])]
  /\ anted' = {} /\ phase' = "lobby"
  /\ lobbyTimeUp' = FALSE /\ roundOver' = FALSE /\ settleWindowOver' = FALSE /\ settleWorks' = TRUE
  /\ UNCHANGED <<wallet, seated, wantsOut>>

\* evict_seat: anyone; Live; seated; not anted; every chip back to the owner's token account; the place opens
EvictSeat(p) ==
  /\ EvictExists /\ phase = "live" /\ seated[p] /\ p \notin anted
  /\ wallet' = (IF EvictPaysOwner THEN [wallet EXCEPT ![p] = @ + chips[p]] ELSE wallet)
  /\ chips' = [chips EXCEPT ![p] = 0]
  /\ seated' = [seated EXCEPT ![p] = FALSE]
  /\ UNCHANGED <<anted, phase, wantsOut>> /\ UNCHANGED clocks

GuestSteps == Join("A") \/ Leave("A") \/ BuyIn("A") \/ CashOut("A") \/ Ante("A") \/ WithdrawAnte("A") \/ GuestWantsOut
OtherSteps == \E p \in Others : Join(p) \/ Leave(p) \/ BuyIn(p) \/ CashOut(p) \/ Ante(p) \/ WithdrawAnte(p)
OpenSteps == LobbyClockRunsOut \/ StartRound \/ WhaleDrawn \/ CancelDraw \/ RoundTimeRunsOut \/ SettleWindowRunsOut \/ Settle \/ AbortRound \/ (\E p \in Players : EvictSeat(p))

GuestIsOut == wantsOut /\ wallet["A"] = START_TOKENS /\ chips["A"] = 0 /\ "A" \notin anted
Done == GuestIsOut /\ UNCHANGED vars

Next == GuestSteps \/ OtherSteps \/ OpenSteps \/ Done

\* Rule 1: no instruction creates or loses money.
MoneyIsKept == wallet["A"] + wallet["B"] + wallet["C"] + Escrow = 3 * START_TOKENS
\* Rule 2: a guest who wants out always has a next step that needs no other player.
GuestMoneyInGame == chips["A"] + (IF "A" \in anted THEN ANTE ELSE 0)
CanGetOutAlone ==
  (wantsOut /\ GuestMoneyInGame > 0) =>
    ENABLED (Leave("A") \/ CashOut("A") \/ WithdrawAnte("A") \/ OpenSteps)
=============================================================================
