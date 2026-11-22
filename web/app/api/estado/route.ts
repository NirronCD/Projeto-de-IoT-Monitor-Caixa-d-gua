import { obterEstado } from "@/lib/estado";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(obterEstado(), { headers: { "Cache-Control": "no-store" } });
}
