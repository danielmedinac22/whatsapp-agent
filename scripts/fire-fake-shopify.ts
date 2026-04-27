import { createHmac } from "node:crypto";

const WORKER_URL =
  process.env.WORKER_URL ??
  "https://whatsapp-worker-production-2cc2.up.railway.app";
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
if (!SECRET) {
  console.error("SHOPIFY_WEBHOOK_SECRET is required");
  process.exit(1);
}

const phone = process.argv[2];
const firstName = process.argv[3] ?? "Daniel";
if (!phone) {
  console.error("usage: tsx fire-fake-shopify.ts <phone> [firstName]");
  process.exit(1);
}

const payload = {
  id: Date.now(),
  email: "test@example.com",
  total_price: "159.00",
  currency: "GTQ",
  customer: {
    first_name: firstName,
    last_name: "Medina",
    phone,
  },
  shipping_address: {
    name: `${firstName} Medina`,
    address1: "Avenida Simulada 123",
    city: "Ciudad de Guatemala",
    phone,
  },
  line_items: [
    { title: "Faja Térmica Anti-cólicos", quantity: 1 },
    { title: "Suplemento Anti-caída", quantity: 2 },
  ],
};

async function main() {
  const body = JSON.stringify(payload);
  const hmac = createHmac("sha256", SECRET!)
    .update(body, "utf8")
    .digest("base64");

  const res = await fetch(`${WORKER_URL}/shopify/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": "orders/create",
    },
    body,
  });

  console.log("status:", res.status);
  console.log("body:", await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
