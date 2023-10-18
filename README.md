# DAC

Demo for dominant assurance contracts.

## Setup

### Git hooks

Run `npm run prepare` to setup git hooks.

When running `git commit` if you get the error

```
[warn] Code style issues found in the above file. Forgot to run Prettier?
```

Run `npm run fix` to reformat the files.

### Dev

Copy `dev.vars.example` to `.dev.vars` and fill in the necessary information.

### Test

Copy `example.env.test.local` to `env.test.local` and fill in the necessary
information.

## Deployment

### Cloudflare Pages

It should automatically deploy when pushing to the `main` branch. During build
time, you need to set the environment variables

- `REACT_APP_WORKER_URL` the the URL of the deployed worker, and
- `REACT_APP_PAYPAL_CLIENT_ID` to your Paypal Client ID. It should be the same
  as the one set in the worker.
- `REACT_APP_GOOGLE_CLIENT_ID` to your Google Client ID ([found
  here](https://console.cloud.google.com/apis/credentials)). You'll need to
  create a project; configure the OAuth consent screen; configure the OAuth 2.0
  Client ID to use the correct domains (include `http://localhost` and
  `http://localhost:3000` for testing). You probably want to add this to `.env.development.local`
  file if testing google log-in since this has no sensible default.
- `REACT_APP_HEADER_PARENTHESIS` (optional) specify text that appears in
  parenthesized in the website header. This is useful for distinguishing testing
  from production. e.g. `REACT_APP_HEADER_PARENTHESIS="test site"` will render
  in the header "Refund Bonus (test site)", `REACT_APP_HEADER_PARENTHESIS=""`
  renders as "Refund Bonus".

### Cloudflare Workers

Run `wranger publish`. Configure the environment variables in `dev.vars.example`
manually on the cloudflare site.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\ Open
[http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\ You will also see any lint errors in
the console.

### `npm test`

Launches the test runner.

### `npm run build`

Builds the app for production to the `build` folder.\ It correctly bundles React
in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\ Your app is ready
to be deployed!

See the section about
[deployment](https://facebook.github.io/create-react-app/docs/deployment) for
more information.

### `npm run test-reverse-spec`

The idea reverse spec was inspired by [Steve Smith's End to End Testing
Considered Harmful][1]. In summary, doing end-to-end tests that include
third-party services make your tests slow and flaky, so it's better to test
against a mock service.

[1]: https://www.stevesmith.tech/blog/end-to-end-testing-considered-harmful/

But to write a mock service you need a spec of the third-party service. We write
a spec of the service in a "reverse.spec" file. To check that the spec is
correct we run `npm run test-reverse-spec` which executes the spec against (a
test-instance of) the official third-party service. If a "test" fails in this
context it means our "reverse.spec" is wrong (or the external service is flaky).

`npm run test` will verify that the mock service is correct by executing the
"reverse.spec" against it. If a test fails in this context it means our mock is
wrong.

## Test script

### Project fully funded

1. Configure the project in /admin
2. Fund the project to completion.
3. The /refund route should return 404.
4. Wait until deadline passed.
5. The /refund route should return 404.
6. No more funds are accepted.
7. Navigate to /admin
8. Type "admin" as username and <ADMIN_PASSWORD> as password.
9. There should be no bonuses to pay out.

### Project not fully funded.

1. Configure the project in /admin
2. Don't fully fund the project.
3. The /refund route should return 404.
4. Wait until the deadline passed.
5. The /refund route should refund a funder until all funders have been
   refunded.
6. No more funds are accepted.
7. Navigate to /admin
8. Type "admin" as username and <ADMIN_PASSWORD> as password.
9. There should be a list of bonuses that need to be payed out.
10. Log-in to paypal and payout the bonuses manually marking them off as you go.
11. Refresh the /admin page. THe marked off payments should not be visable.

### Let people use a draft project

1. Log-in as admin at /adminLogin.
2. Open a URL /projects/test/edit.
3. Fill-out form. Click submit.
4. Share the form with a gmail user.
5. Open a different browser (or clear your cookies).
6. Navigate to /projects/test/edit. The browser should redirect you to a login
   page.
7. Login with google. You should get redirected back to the edit page.
8. Make an edit. Click submit. It should redirect to /projects/test and the
   changes should be reflected.
9. Click on the PayPal button. It should not work.
10. Click on the edit link. It should take you to /projects/test.

## Documentation

The original ideas come from [Alex
Tabarrok](https://mason.gmu.edu/~atabarro/PrivateProvision.pdf) and [Yaseen
Mowzer](https://www.lesswrong.com/posts/CwgHX9tbfASqxjpsc/the-economics-of-the-asteroid-deflection-problem)

It is much better explained above, but a very short introduction is: A Dominant
Assurance Contract is a fundraising mechanism where, in the event the funding
threshold is not met, the backers will get a refund plus an extra reward for
their support. The reward mechanism is to encourage interested but dispassionate
funders to fund the effort rather than hold their money and wait for someone
else to complete the funding (a.k.a. free-riding).

### Terms

Terms defined below. Initially these are derived from the original paper
(Tabarrok, 1998), but sometimes they had too much of a "game theory" flavor and
have been reworked (actually to have a more "computer science" flavor):

- **Dominant Assurance Contract:**

  1. An assurance contract where the equilibrium is to contribute to funding
     the public good as a dominant strategy.
  2. An assurance contract where funders are offered a refund plus a refund
     bonus if the contract fails, in order to encourange funders to commit to the
     contract.

- **Assurance Contract:** A contract where the owner pledges to take action /
  create a good if a given minimum threshhold of contributions are made.
  Example: If $10000 is raised by the community, a contractor will build a road.
  If the minimum is not raised, the contractor does nothing.

  Note that in this framework the contract does not mean "build a road", the
  contract is the agreement to do something if a threshhold is met.

- **Success:** The Contract Funding Goal is met.

- **Failure:** The Contract Funding Goal is not met before the Funding Deadline.

- **Producer:** The person who offers the Contract.

- **Consumer:** A person, one of many presumably, who choose to Accept (fund) or
  Reject the Contract.

- **Accept:** When an individual Consumer chooses to fund the Contract by
  Pledging an amount to the Contract.

- **Reject:** When an individual Consumer chooses to not fund the Contract.

- **Refund Bonus:** A payoff given by the Producer to a Consumer who has
  Accepted a Contract that Fails. To be clear, if the Pledge is $100, and the
  Refund Bonus is $5 the Consumer does not forfeit $100 and get $5 back as a
  Refund Bonus, instead they forfeit nothing and profit $5 with the Refund
  Bonus.

- **Pledge:** A payment given by a Consumer to the Producer if the Consumer has
  Accepted a Contract and the Contract Succeeds.

- **Funding Goal:** When the Sum of all Pledges >= Funding Goal, the Contract is
  a Success.

- **Funding Deadline:** The date at which a Contract ends and, if the Funding
  Goal has not been met, becomes a Failed Contract.
