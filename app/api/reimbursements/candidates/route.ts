import { withStore } from "@/lib/api";
import { incomingCandidates } from "@/lib/reimburse";

export const dynamic = "force-dynamic";

/** Incoming money for the Net off picker: ?q=&min=&max=&from=&to= (most recent first). */
export const GET = (req: Request) =>
  withStore((store) => {
    const p = new URL(req.url).searchParams;
    const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
    return incomingCandidates(store, {
      q: p.get("q") || undefined,
      min_amount: num("min"),
      max_amount: num("max"),
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      limit: 50,
    });
  });
