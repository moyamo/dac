# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Setup

### Git hooks

Run `npm run prepare` to setup git hooks.

When running `git commit` if you get the error

```
[warn] Code style issues found in the above file. Forgot to run Prettier?
```

Run `prettier --write .` to reformat the files.

### Dev

Copy `dev.vars.example` to `.dev.vars` and fill in the necessary information.

### Test

Copy `example.env.test.local` to `env.test.local` and fill in the necessary
information.

## Deployment

### Cloudflare Pages

It should automatically deploy when pushing to the `main` branch. You will need
to set the environment variable `REACT_APP_WORKER_URL` to the URL of the
deployed worker during build time.

### Cloudflare Workers

Run `wranger publish`. Configure the environment variables in `dev.vars.example`
manually on the cloudflare site.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

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

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
