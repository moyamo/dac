# Introduction
The original ideas come from Alex Tabarrok and Yaseen Mowzer

Tabarrok: 

https://mason.gmu.edu/~atabarro/PrivateProvision.pdf

Mowzer: 

https://www.lesswrong.com/posts/CwgHX9tbfASqxjpsc/the-economics-of-the-asteroid-deflection-problem
https://dac.mowzer.co.za/

It is much better explained above, but a very short introduction is: 

A Dominant Assurance Contract is a fundraising mechanism where, in the event the funding threshold is not met, the backers will get a refund plus an extra reward for their support. The reward mechanism is to encourage interested but dispassionate funders to fund the effort rather than hold their money and wait for someone else to complete the funding (a.k.a. freeloading).

# Terms
Terms defined below. Initially these are derived from the original paper (Tabarrok, 1998), but sometimes they had too much of a "game theory" flavor and have been reworked (actually to have a more "computer science" flavor):

**Dominant Assurance Contract** - (1). An assurance contract where the equilibrium is to contribute to funding the public good as a dominant strategy. (2). An assurance contract where funders are offered a refund plus a refund bonus if the contract fails, in order to encourange funders to commit to the contract.

**Assurance Contract** - A contract where the owner pledges to take action / create a good if a given minimum threshhold of contributions are made. 
Example: If $10000 is raised by the community, a contractor will build a road. If the minimum is not raised, the contractor does nothing.

Note that in this framework the contract does not mean "build a road", the contract is the agreement to do something if a threshhold is met.

**Success** - The Contract Funding Goal is met.

**Failure** - The Contract Funding Goal is not met before the Funding Deadline.

**Producer** - The person who offers the Contract.

**Consumer** - A person, one of many presumably, who choose to Accept (fund) or Reject the Contract.

**Accept** - When an individual Consumer chooses to fund the Contract by Pledging an amount to the Contract.

**Reject** - When an individual Consumer chooses to not fund the Contract.

**Refund Bonus** - A payoff given by the Producer to a Consumer who has Accepted a Contract that Fails. To be clear, if the Pledge is $100, and the Refund Bonus is $5 the Consumer does not forfeit $100 and get $5 back as a Refund Bonus, instead they forfeit nothing and profit $5 with the Refund Bonus.

**Pledge** - A payment given by a Consumer to the Producer if the Consumer has Accepted a Contract and the Contract Succeeds.

**Funding Goal** - When the Sum of all Pledges >= Funding Goal, the Contract is a Success.

**Funding Deadline** - The date at which a Contract ends and, if the Funding Goal has not been met, becomes a Failed Contract.



