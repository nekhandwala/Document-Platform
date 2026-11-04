import { createApp } from "./server";
import { InMemoryDocumentStore } from "./store/memory";

const port = Number(process.env.PORT ?? 3001);
const app = createApp(new InMemoryDocumentStore());

app.listen(port, () => {
  console.log(`api listening on ${port}`);
});
