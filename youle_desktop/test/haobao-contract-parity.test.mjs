import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateHaobaoContract } from "../src/shared/haobao/contracts.mjs";

const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/haobao-contracts.json", import.meta.url), "utf8"));
for (const fixture of fixtures.cases) {
  test(`Python/JavaScript parity: ${fixture.id}`, () => {
    const input = structuredClone(fixture.value);
    if (fixture.valid) {
      assert.deepEqual(validateHaobaoContract(fixture.contract, input), input);
    } else {
      assert.throws(() => validateHaobaoContract(fixture.contract, input));
    }
    assert.deepEqual(input, fixture.value);
  });
}
