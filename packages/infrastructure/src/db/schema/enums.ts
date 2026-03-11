import {
  DOWNLOAD_EVENT_TYPE_VALUES,
  FILE_MODERATION_ACTION_VALUES,
  FILE_STATUS_VALUES,
  OPERATIONAL_ANOMALY_TYPE_VALUES,
  REPORT_REASON_VALUES,
  REPORT_STATUS_VALUES
} from '@anonshare/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

export const fileStatusEnum = pgEnum('file_status', FILE_STATUS_VALUES);

export const downloadEventTypeEnum = pgEnum('download_event_type', DOWNLOAD_EVENT_TYPE_VALUES);

export const fileModerationActionEnum = pgEnum(
  'file_moderation_action',
  FILE_MODERATION_ACTION_VALUES
);

export const reportReasonEnum = pgEnum('report_reason', REPORT_REASON_VALUES);

export const reportStatusEnum = pgEnum('report_status', REPORT_STATUS_VALUES);

export const operationalAnomalyTypeEnum = pgEnum(
  'operational_anomaly_type',
  OPERATIONAL_ANOMALY_TYPE_VALUES
);
