import { z } from "zod";

export const sendMessageInput = z.object({
  jid: z.string().min(1),
  body: z.string().min(1).max(4096),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInput>;

export const templateTypeValues = [
  "general",
  "followup",
  "remarketing",
  "confirmation_ack",
  "dropi_guia_generada",
  "dropi_recolectado",
  "dropi_en_transito",
  "dropi_con_mensajero",
  "dropi_entregado",
] as const;
export type TemplateType = (typeof templateTypeValues)[number];

export const templateInput = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(4096),
  variables: z.array(z.string()).default([]),
  type: z.enum(templateTypeValues).default("general"),
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
  confirmationAckTemplateId: z.string().uuid().nullable(),
  activateAgentOnConfirm: z.boolean().default(true),
  dropiEnabled: z.boolean().default(false),
  dropiDryRun: z.boolean().default(true),
  dropiPollIntervalMin: z.number().int().min(1).max(120).default(10),
  dropiSyncIntervalMin: z.number().int().min(1).max(240).default(15),
  dropiMatchWindowDays: z.number().int().min(1).max(60).default(5),
  dropiTemplateGuiaId: z.string().uuid().nullable().default(null),
  dropiTemplateRecolectadoId: z.string().uuid().nullable().default(null),
  dropiTemplateEnTransitoId: z.string().uuid().nullable().default(null),
  dropiTemplateConMensajeroId: z.string().uuid().nullable().default(null),
  dropiTemplateEntregadoId: z.string().uuid().nullable().default(null),
});
export type AgentSettingsInput = z.infer<typeof agentSettingsInput>;

export const dropiConnectionInput = z.object({
  apiBaseUrl: z.string().url().optional(),
  email: z.string().email().nullable().optional(),
  password: z.string().min(1).nullable().optional(),
  bearerToken: z.string().min(20).nullable().optional(),
});
export type DropiConnectionInput = z.infer<typeof dropiConnectionInput>;

export const shopifyConnectionInput = z.object({
  shopDomain: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i, {
      message: "debe ser un dominio *.myshopify.com",
    }),
  adminAccessToken: z.string().min(20).max(200),
  apiVersion: z.string().min(4).max(20).optional(),
});
export type ShopifyConnectionInput = z.infer<typeof shopifyConnectionInput>;

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
      address1: z.string().nullish(),
      address2: z.string().nullish(),
      city: z.string().nullish(),
      province: z.string().nullish(),
      zip: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
  total_price: z.string().nullish(),
  currency: z.string().nullish(),
});
export type ShopifyOrderWebhook = z.infer<typeof shopifyOrderWebhook>;
