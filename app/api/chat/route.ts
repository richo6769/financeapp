import { body, withStore } from "@/lib/api";
import { runChatTurn } from "@/lib/chat/agent";
import { UserError } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = () =>
  withStore((store) => store.select("chat_messages", undefined, { order: { column: "created_at" } }));

export const POST = (req: Request) =>
  withStore(async (store) => {
    const { message } = await body<{ message: string }>(req);
    const text = (message ?? "").trim();
    if (!text) throw new UserError("Message is empty");
    if (text.length > 4000) throw new UserError("Message is too long");
    const history = await store.select("chat_messages", undefined, { order: { column: "created_at" } });
    const [userMsg] = await store.insert("chat_messages", [{ role: "user", content: text, tool_calls: null }]);
    const turn = await runChatTurn(store, history, text);
    const [assistantMsg] = await store.insert("chat_messages", [
      { role: "assistant", content: turn.reply, tool_calls: turn.tool_calls.length ? turn.tool_calls : null },
    ]);
    return { user: userMsg, assistant: assistantMsg, mode: turn.mode };
  });

export const DELETE = () => withStore(async (store) => ({ removed: await store.remove("chat_messages", {}) }));
