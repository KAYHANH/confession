'use client';

import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  ExternalLink,
  ShieldCheck,
  Clock,
  ArrowRight,
  Search,
} from 'lucide-react';
import { SheetSyncReport, SheetSyncItem } from '@/types';

interface SheetSyncReportModalProps {
  report: SheetSyncReport | null;
  isOpen: boolean;
  onClose: () => void;
  spreadsheetId?: string;
}

export function SheetSyncReportModal({
  report,
  isOpen,
  onClose,
  spreadsheetId,
}: SheetSyncReportModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState<string>('ALL');

  if (!isOpen || !report) return null;

  const filteredItems = (report.reconciliationItems || []).filter((item: SheetSyncItem) => {
    const matchesSearch =
      !searchQuery ||
      item.textPreview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.submitter || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.rowNumber.toString().includes(searchQuery) ||
      (item.evidence || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAction = filterAction === 'ALL' || item.actionTaken === filterAction;
    return matchesSearch && matchesAction;
  });

  const sheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-zinc-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-zinc-900 text-base">
                  Google Sheets Synchronization Report
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Authoritative Sync
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Completed {new Date(report.completedAt).toLocaleString()} ({Math.round(report.durationMs / 1000)}s)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Google Sheet</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
              <span className="text-[11px] font-medium text-zinc-500 block">Total Rows</span>
              <span className="text-xl font-bold text-zinc-900 mt-0.5 block">
                {report.totalRowsExamined}
              </span>
            </div>

            <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl">
              <span className="text-[11px] font-medium text-blue-700 block">New Imported</span>
              <span className="text-xl font-bold text-blue-900 mt-0.5 block">
                {report.newRowsImported}
              </span>
            </div>

            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl">
              <span className="text-[11px] font-medium text-emerald-700 block">Published (Verified)</span>
              <span className="text-xl font-bold text-emerald-900 mt-0.5 block">
                {report.alreadyPublishedVerified}
              </span>
            </div>

            <div className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl">
              <span className="text-[11px] font-medium text-purple-700 block">Scheduled</span>
              <span className="text-xl font-bold text-purple-900 mt-0.5 block">
                {report.scheduledRecords}
              </span>
            </div>

            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl">
              <span className="text-[11px] font-medium text-amber-700 block">Queued</span>
              <span className="text-xl font-bold text-amber-900 mt-0.5 block">
                {report.queuedRecords}
              </span>
            </div>

            <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl">
              <span className="text-[11px] font-medium text-rose-700 block">Duplicates Protected</span>
              <span className="text-xl font-bold text-rose-900 mt-0.5 block">
                {report.duplicatesDetected}
              </span>
            </div>

            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl">
              <span className="text-[11px] font-medium text-emerald-700 block">Sheet Cells Written</span>
              <span className="text-xl font-bold text-emerald-900 mt-0.5 block">
                {report.sheetUpdatesSuccessful}
              </span>
            </div>

            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
              <span className="text-[11px] font-medium text-zinc-500 block">DB Records Updated</span>
              <span className="text-xl font-bold text-zinc-900 mt-0.5 block">
                {report.existingRecordsUpdated}
              </span>
            </div>

            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
              <span className="text-[11px] font-medium text-zinc-500 block">Deleted Upstream</span>
              <span className="text-xl font-bold text-zinc-900 mt-0.5 block">
                {report.deletedRecords}
              </span>
            </div>

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl">
              <span className="text-[11px] font-medium text-red-700 block">Confirmed Failed</span>
              <span className="text-xl font-bold text-red-900 mt-0.5 block">
                {report.confirmedFailedRecords}
              </span>
            </div>

            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl">
              <span className="text-[11px] font-medium text-amber-700 block">Unknown / Quarantined</span>
              <span className="text-xl font-bold text-amber-900 mt-0.5 block">
                {report.unknownRecords}
              </span>
            </div>

            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
              <span className="text-[11px] font-medium text-zinc-500 block">Held / Low Value</span>
              <span className="text-xl font-bold text-zinc-900 mt-0.5 block">
                {report.lowValueOrReviewRecords}
              </span>
            </div>
          </div>

          {/* Sync Errors (if any) */}
          {report.errors && report.errors.length > 0 && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-rose-800 font-semibold text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Warnings & Errors During Sync</span>
              </div>
              <ul className="text-xs text-rose-700 list-disc list-inside space-y-1">
                {report.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Reconciliation Audit Log */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Itemized Reconciliation Log ({filteredItems.length} records)
              </h4>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by text, row, submitter..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1 text-xs border border-zinc-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-zinc-900 w-52"
                  />
                </div>

                <select
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-zinc-300 rounded-lg bg-white focus:outline-hidden"
                >
                  <option value="ALL">All Actions</option>
                  <option value="PUBLICATION_VERIFIED">Publication Verified</option>
                  <option value="STATUS_CORRECTED">Status Corrected</option>
                  <option value="IMPORTED">Imported</option>
                  <option value="QUARANTINED_DUPLICATE">Duplicate Quarantined</option>
                  <option value="MARKED_DELETED">Marked Deleted</option>
                  <option value="UNCHANGED">Unchanged</option>
                </select>
              </div>
            </div>

            <div className="border border-zinc-200 rounded-xl overflow-hidden shadow-xs">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600 sticky top-0 z-10 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3 w-16">Row #</th>
                      <th className="py-2.5 px-3">Confession Content</th>
                      <th className="py-2.5 px-3 w-36">Sheet Status Change</th>
                      <th className="py-2.5 px-3 w-28">DB Status</th>
                      <th className="py-2.5 px-3 w-36">Action</th>
                      <th className="py-2.5 px-3">Reconciliation Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 bg-white">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-500">
                          No items match the selected filter.
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50/70 transition-colors">
                          <td className="py-2 px-3 font-mono font-bold text-zinc-700">
                            #{item.rowNumber}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-medium text-zinc-900 block truncate max-w-xs">
                              {item.textPreview}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              by {item.submitter || 'Anonymous'}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <span className="text-zinc-500">{item.sheetStatusBefore || 'EMPTY'}</span>
                              <ArrowRight className="w-3 h-3 text-zinc-400 shrink-0" />
                              <span className="font-bold text-zinc-900">{item.sheetStatusAfter}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-mono text-[11px] text-zinc-700">
                              {item.dbStatus}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            {item.actionTaken === 'PUBLICATION_VERIFIED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Verified Published
                              </span>
                            )}
                            {item.actionTaken === 'STATUS_CORRECTED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                Status Corrected
                              </span>
                            )}
                            {item.actionTaken === 'IMPORTED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                Imported
                              </span>
                            )}
                            {item.actionTaken === 'QUARANTINED_DUPLICATE' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                Duplicate
                              </span>
                            )}
                            {item.actionTaken === 'MARKED_DELETED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-200 text-zinc-800">
                                Deleted
                              </span>
                            )}
                            {item.actionTaken === 'UNCHANGED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-600">
                                Unchanged
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-zinc-600">
                            {item.evidence || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Database & Instagram are authoritative. Zero posts published during sync.</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-semibold hover:bg-zinc-800 transition-colors"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}
