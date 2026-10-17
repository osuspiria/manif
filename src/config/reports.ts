/** Reasons offered by "Reportar" (labels in pt.report.reasons). */
export const REPORT_REASONS = ['fake', 'wrong_info', 'offensive', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
