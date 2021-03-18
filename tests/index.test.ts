import run from "../src";
import dotenv from "dotenv";
dotenv.config();

test("Run Action", async (done) => {
  jest.setTimeout(600000); // 10 min
  await run({
    roamGraph: "roam-depot-developers",
    roamUsername: "dvargas92495@gmail.com",
    roamPassword: process.env.ROAM_PASSWORD || "",
  })
    .then(() => done())
    .catch(({ message }) => fail(message));
});
