import { syncOne } from "../server/worker.ts";
const id = process.argv[2];
if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw Error("Expected purchase UUID");
for (let i = 0; i < (id ? 1 : 25); i++) {
  const result = await syncOne(id);
  console.log(result);
  if (!result.claimed) break;
}
