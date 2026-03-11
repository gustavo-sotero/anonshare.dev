import { REPORT_REASON_VALUES, REPORT_STATUS_VALUES } from '@anonshare/domain';
import { z } from 'zod';

export const reportRequestSchema = z.object({
  reason: z.enum(REPORT_REASON_VALUES),
  /** Optional free-text context; max 1000 characters. */
  message: z.string().max(1000).optional()
});

export type ReportRequest = z.infer<typeof reportRequestSchema>;

export const reportResponseSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime()
});

export type ReportResponse = z.infer<typeof reportResponseSchema>;

// Exposed for runtime checks and DB enum seeding
export { REPORT_REASON_VALUES as reportReasonValues, REPORT_STATUS_VALUES as reportStatusValues };
