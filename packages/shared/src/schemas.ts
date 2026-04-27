import { z } from "zod";

export const sendMessageInput = z.object({
  jid: z.string().min(1),
  body: z.string().min(1).max(4096),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInput>;

export const templateInput = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(4096),
  variables: z.array(z.string()).default([]),
});
export type TemplateInput = z.infer<typeof templateInput>;

export const agentSettingsInput = z.object({
  systemPrompt: z.string().min(1).max(8000),
  model: z.string().min(1),
  debounceMs: z.number().int().min(0).max(120_000),
  followupDelayMs: z.number().int().min(60_000).max(3_600_000),
  followupTemplateId: z.string().uuid().nullable(),
  remarketingDelayMs: z.number().int().min(60_000).max(48 * 60 * 60_000),
  remarketingTemplateId: z.string().uuid().nullable(),
  activateAgentOnConfirm: z.boolean().default(true),
});
export type AgentSettingsInput = z.infer<typeof agentSettingsInput>;

export const shopifyOrderWebhook = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  customer: z
    .object({
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      phone: z.string().nullish(),
    })
    .nullish(),
  phone: z.string().nullish(),
  shipping_address: z
    .object({
      phone: z.string().nullish(),
      name: z.string().nullish(),
    })
    .nullish(),
  total_price: z.string().nullish(),
  currency: z.string().nullish(),
});
export type ShopifyOrderWebhook = z.infer<typeof shopifyOrderWebhook>;
