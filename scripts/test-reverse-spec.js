"use strict";

// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = "test";
process.env.NODE_ENV = "test";
process.env.PUBLIC_URL = "";

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on("unhandledRejection", (err) => {
  throw err;
});

// Ensure environment variables are read.
require("../config/env");

const jest = require("jest");
const child_process = require("child_process");

child_process.execSync("node scripts/miniflarejestbuild");

// Needed to run miniflare test https://miniflare.dev/testing/jest
process.env.NODE_OPTIONS = "--experimental-vm-modules";

let argv = process.argv.slice(2);

// Run against the right files
argv.push("--testMatch");
argv.push("**/*.reverse.spec.{js,jsx,ts,tsx}");

process.env.REVERSE_SPEC_TEST_WHAT = "SPEC";

jest.run(argv);
