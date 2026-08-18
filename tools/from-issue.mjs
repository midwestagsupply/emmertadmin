#!/usr/bin/env node
/* The workflow's one step: read the issue, change the files, leave a note.
   Kept as a file rather than inline in the YAML because a shell-quoted
   script inside a workflow is unreadable and unrunnable anywhere else. */
import { writeFileSync } from "node:fs";
import { main, Refused } from "./apply-update.mjs";

const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

try {
  const r = main({
    body: process.env.BODY,
    association: process.env.WHO,
    todayISO,
  });
  console.log("changed: " + r.did.join(" "));
  writeFileSync("/tmp/said", "Done.\n\n- " + r.did.join("\n- ") + "\n");
} catch (e) {
  /* A refusal is an ordinary outcome of a form, not a broken job: somebody
     mistyped a time. It is reported on the issue and the run goes green.
     Anything else is a real failure and is allowed to fail the run. */
  if (!(e instanceof Refused)) {
    writeFileSync("/tmp/said",
      "**Nothing was changed.** Something went wrong applying this and it needs " +
      "a look at the Actions log.\n");
    writeFileSync("/tmp/failed", "1");
    console.error(e);
    process.exit(1);
  }
  const why = e.message.charAt(0).toUpperCase() + e.message.slice(1);
  writeFileSync("/tmp/said", "**Nothing was changed.** " + why + "\n");
  writeFileSync("/tmp/failed", "1");
  console.log("refused: " + e.message);
}
