import { auth as authConfig } from '@anonshare/infrastructure/config';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import { getDb as getDbShared } from '../support';
import {
  defaultFindSessionById,
  defaultGetDownloadCounts,
  defaultGetQueues,
  defaultListAnomalies,
  defaultListAutoHiddenCountsByDay,
  defaultListDismissedReportCountsByDay,
  defaultListFileStatusCounts,
  defaultListOpenAnomalyCounts,
  defaultListRateLimitBlockedCountsByDay,
  defaultListReportCountsByDay,
  defaultListReportStatusCounts,
  defaultListResolvedReportCountsByDay,
  enqueueCleanupFileJob
} from './queries';
import type { AdminRouterDeps, ResolvedAdminRouterDeps } from './types';

export function resolveAdminRouterDeps(deps: AdminRouterDeps = {}): ResolvedAdminRouterDeps {
  return {
    findSessionById: deps.findSessionById ?? defaultFindSessionById,
    getSessionSecret: deps.getSessionSecret ?? authConfig.sessionSecret,
    listAnomalies: deps.listAnomalies ?? defaultListAnomalies,
    listOpenAnomalyCounts: deps.listOpenAnomalyCounts ?? defaultListOpenAnomalyCounts,
    listReportStatusCounts: deps.listReportStatusCounts ?? defaultListReportStatusCounts,
    listReportCountsByDay: deps.listReportCountsByDay ?? defaultListReportCountsByDay,
    listAutoHiddenCountsByDay: deps.listAutoHiddenCountsByDay ?? defaultListAutoHiddenCountsByDay,
    listResolvedReportCountsByDay:
      deps.listResolvedReportCountsByDay ?? defaultListResolvedReportCountsByDay,
    listDismissedReportCountsByDay:
      deps.listDismissedReportCountsByDay ?? defaultListDismissedReportCountsByDay,
    listRateLimitBlockedCountsByDay:
      deps.listRateLimitBlockedCountsByDay ?? defaultListRateLimitBlockedCountsByDay,
    listFileStatusCounts: deps.listFileStatusCounts ?? defaultListFileStatusCounts,
    getDownloadCounts: deps.getDownloadCounts ?? defaultGetDownloadCounts,
    getAllowedGithubUserId: deps.getAllowedGithubUserId ?? authConfig.githubAllowedUserId,
    getQueues: deps.getQueues ?? defaultGetQueues,
    headStorageObject: deps.headStorageObject ?? storageAdapter.head,
    now: deps.now ?? (() => new Date()),
    enqueueCleanupFile: deps.enqueueCleanupFile ?? enqueueCleanupFileJob,
    getDb: deps.getDb ?? getDbShared
  };
}
