import { withStore } from "@/lib/api";
import { dashboard } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = () => withStore((store) => dashboard(store));
