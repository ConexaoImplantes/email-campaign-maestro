// Tracking pixel endpoint. Marks recipient as opened.
import { createFileRoute } from "@tanstack/react-router";

// 1x1 transparent GIF
const PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

export const Route = createFileRoute("/api/public/hooks/track-open")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const rid = new URL(request.url).searchParams.get("rid");
        if (rid && /^[0-9a-f-]{36}$/i.test(rid)) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin
              .from("recipients")
              .update({ opened_at: new Date().toISOString() })
              .eq("id", rid)
              .is("opened_at", null);
          } catch {
            /* swallow — pixel must always return */
          }
        }
        return new Response(PIXEL, {
          headers: {
            "content-type": "image/gif",
            "cache-control": "no-store, no-cache, must-revalidate, private",
            "pragma": "no-cache",
          },
        });
      },
    },
  },
});
