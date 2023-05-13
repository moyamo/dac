"use strict";

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on("unhandledRejection", (err) => {
  throw err;
});

const child_process = require("child_process");
const fs = require("fs");

// Miniflare doesn't yet integrate with wrangler v2 so we need to manually
// build.
child_process.execSync(
  "wrangler publish --dry-run --outdir miniflarejestbuild"
);

// The sourceRoot seems to confuse the coverage system.
// Rather just delete it.
const map = JSON.parse(fs.readFileSync("miniflarejestbuild/worker.js.map"));
delete map["sourceRoot"];
fs.writeFileSync("miniflarejestbuild/worker.js.map", JSON.stringify(map));
