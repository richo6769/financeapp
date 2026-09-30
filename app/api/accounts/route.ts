import { withStore } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = () => withStore((store) => store.select("accounts", undefined, { order: { column: "name" } }));
