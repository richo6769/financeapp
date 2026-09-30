import { withStore } from "@/lib/api";
import { pendingSuggestions } from "@/lib/suggest";

export const dynamic = "force-dynamic";

export const GET = () => withStore((store) => pendingSuggestions(store));
