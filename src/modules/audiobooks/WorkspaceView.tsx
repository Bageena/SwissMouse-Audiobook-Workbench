import { ArrowRight } from 'lucide-react';
import { WorkflowLayout, workflowPages } from '../../components/WorkflowNavigation';
import { resetPageLayout } from '../../utils/desktopLayout';
import { ProjectOverview } from '../../components/ProjectOverview';
import { ActivityPanel } from '../../components/ActivityPanel';
import { Header } from '../../components/Header';
import { audiobookModule } from '../builtins';
import { canReviewChapters } from '../../utils/pipelineRerun';
import { chapterReviewChanged } from '../../utils/chapterReviewDraft';
import { QUICK_ADD_CATEGORIES } from '../../utils/metadataQuickAdd';
import type { WorkbenchConfig, JobLog } from '../../types';
import type { useAudiobookWorkspace } from './useAudiobookWorkspace';

/** Legacy screen composition. The shell supplies common commands, not book operations. */
export function AudiobookWorkspaceView({ workspace, config, shell }: {
  workspace: ReturnType<typeof useAudiobookWorkspace>;
  config: WorkbenchConfig;
  shell: {
    onPreferences: (section: string) => void; onQuickSettings: () => void; onPurge: () => void;
    onToggleLogs: () => void; onShowLogs: () => void; showLogs: boolean;
    onToggleActivity: () => void; onCloseActivity: () => void; showActivity: boolean;
    logs: JobLog[]; onConfigChange: (config: WorkbenchConfig) => void;
  };
}) {
  const { BookFiles, LibraryManager, Step1MergeDetect, Step2ChapterReview, Step3Metadata, Step4Export, Step5Validate } = audiobookModule.screens;
  const { libraryBooks, libraryScanning, libraryScanWarning, activeStep, setActiveStep, chapterReviewActionHost, setChapterReviewActionHost, metadataReviewActionHost, setMetadataReviewActionHost, convertActionHost, setConvertActionHost, processReadiness, setProcessReadiness, reviewFilesOpen, setReviewFilesOpen, legacyImportMode, setLegacyImportMode, importError, navigationError, edit, handleNavigate, handlePlayLibraryBook, handleMetadataDraftChange, isProcessingStep1, isBuildingM4b, exportError, libraryPlayerJob, libraryPlayRequest, exportJobId, exportProgressMessage, isValidating, currentJob, handleRatingChange, handleCloseProject, handleOpenProject, refreshCurrentJob, handleRunStep1, handleRerunStep, handleUpdateJobSettings, handleSourceLoaded, handleStartImport, handleCancelImport, handleFinishImport, handleFinishFileReview, handleOrganizeLibrary, handleSaveChapters, handlePersistMetadataDraft, handleSaveMetadata, handleUpdateMetadataJson, handleMoveExportFolder, handleBuildM4b, handleValidate, handleAddQuickTag, handleSaveLibraryMetadata, handleWriteProjectAudioMetadata, handleWriteLibraryAudioMetadata, handleRelinkLibraryBook, handleOpenLibraryFolder, handleRefreshLibrary, handleFinishProcessing, handleMoveInboxToLibrary, handleUpdateLibraryJson, handleMoveLibraryFolders, handleDeleteMultiple, handleDeleteProject, handleRecheckProjectAudio, handleBookFilesChanged, handleContinueFromFiles } = workspace;
  const workspaceHeader = (
      <Header
        ambientGlow={config?.player_ambient_glow !== false}
        currentJob={currentJob}
        libraryPlayerJob={libraryPlayerJob}
        playRequest={libraryPlayRequest}
        onRatingChange={handleRatingChange}
        onCloseProject={handleCloseProject}
        onOpenNewJob={() => void handleStartImport()}
        onOpenSettings={() => shell.onPreferences('appearance')}
        onOpenQuickSettings={shell.onQuickSettings}
        onResetPageLayout={() => resetPageLayout(!currentJob ? 'library' : currentJob.importPending || legacyImportMode || reviewFilesOpen ? 'files' : `step-${activeStep}`)}
        onOpenPurge={shell.onPurge}
        onOpenRequirements={() => shell.onPreferences('requirements')}
        onToggleLogs={shell.onToggleLogs}
        showLogs={shell.showLogs}
        onToggleActivity={shell.onToggleActivity}
          busy={isProcessingStep1 || isBuildingM4b || isValidating}
          onShowLogs={shell.onShowLogs}
          onRecheckAudio={handleRecheckProjectAudio}
        showActivity={shell.showActivity}
      />
  );

  return <>
      <ActivityPanel exportJobId={exportJobId} onRefresh={handleRefreshLibrary} open={shell.showActivity} onClose={shell.onCloseActivity} job={currentJob} scanning={libraryScanning} scanWarning={libraryScanWarning} building={isBuildingM4b} validating={isValidating} exportMessage={exportProgressMessage} exportError={exportError} logs={shell.logs} onLogs={shell.onShowLogs} onReview={step => { setReviewFilesOpen(false); setLegacyImportMode(false); setActiveStep(step); }} />
      {/* Main Workspace */}
      <main className={`flex-1 w-full mx-auto px-3 sm:px-5 lg:px-7 py-4 sm:py-6 space-y-5 ${currentJob ? 'max-w-[1480px]' : 'max-w-none'}`}>
        {importError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{importError}</p>}
        {navigationError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{navigationError}</p>}
        <WorkflowLayout header={workspaceHeader} key={currentJob?.id || 'library'} job={currentJob} files={!!currentJob && (currentJob.importPending || legacyImportMode || reviewFilesOpen)} activeStep={activeStep}
          onNavigate={handleNavigate}>
        {currentJob && (currentJob.importPending || legacyImportMode || reviewFilesOpen) ? (
          <BookFiles key={currentJob.id} job={currentJob} config={config} onUpdateJobSettings={handleUpdateJobSettings}
            onContinue={handleContinueFromFiles}
            onImported={async updated => { if (currentJob.importPending && !currentJob.parts.length) await handleSourceLoaded(updated); else await refreshCurrentJob(currentJob.id); }}
            onChanged={handleBookFilesChanged}>
            {currentJob.parts.length > 0 && <Step3Metadata key={currentJob.id} mode={currentJob.importPending ? 'import' : 'file-review'} job={currentJob} quickTags={config?.quick_tags || [...QUICK_ADD_CATEGORIES]} onAddQuickTag={handleAddQuickTag} onSaveMetadata={handleSaveMetadata} onWriteAudioMetadata={handleWriteProjectAudioMetadata} onUpdateJson={handleUpdateMetadataJson} onMoveExportFolder={handleMoveExportFolder} onPersistDraft={handlePersistMetadataDraft} draftMetadata={edit.metadataDraft?.jobId === currentJob.id ? edit.metadataDraft.metadata : undefined} onDraftChange={handleMetadataDraftChange} onNextStep={() => {}} onImportAction={handleFinishImport} onCancelImport={handleCancelImport} onFinishFileReview={handleFinishFileReview} onOrganizeLibrary={handleOrganizeLibrary} />}
          </BookFiles>
        ) : currentJob ? (
          <>
            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
              {activeStep === 2 && <div ref={setChapterReviewActionHost} className="justify-self-end md:col-start-3 md:row-start-1" />}
              {activeStep === 3 && <div ref={setMetadataReviewActionHost} className="justify-self-end md:col-start-3 md:row-start-1" />}
              {activeStep === 4 && <div ref={setConvertActionHost} className="justify-self-end md:col-start-3 md:row-start-1" />}
              <h1 className="page-title-label justify-self-center inline-block text-xl font-bold md:col-start-2">{workflowPages[activeStep - 1].label}</h1>
              {activeStep === 1 && <div className="flex items-center justify-self-end gap-3">
                <svg role="img" aria-label={processReadiness?.jobId === currentJob.id && processReadiness.valid ? 'Processing settings are valid' : 'Processing settings need attention'} viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`process-readiness shrink-0 ${processReadiness?.jobId === currentJob.id && processReadiness.valid ? 'text-emerald-700' : 'text-red-700'}`} style={{ filter: 'drop-shadow(0 3px 2px rgb(48 38 20 / 0.28))' }}>
                  <circle cx="16" cy="16" r="13" />
                  {processReadiness?.jobId === currentJob.id && processReadiness.valid ? <path d="m10 16 4 4 8-9" /> : <path d="m11 11 10 10m0-10L11 21" />}
                </svg>
                <button type="button" disabled={isProcessingStep1 || !canReviewChapters(currentJob)} onClick={() => setActiveStep(2)} title={canReviewChapters(currentJob) ? 'Review chapter starts and names' : 'Run the selected workflow below to prepare chapter review'} className="paper-action-dark inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-40">Continue to Review Chapters<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>}
            </div>
            <ProjectOverview key={currentJob.id} job={currentJob} />

            {/* Active Step Content */}
            {activeStep === 1 && (
              <Step1MergeDetect
                key={currentJob.id}
                onReadinessChange={setProcessReadiness}
                job={currentJob}
                config={config}
                onRunStep1={handleRunStep1}
                onRerunStep={handleRerunStep}
                isRunning={isProcessingStep1}
                onUpdateJobSettings={handleUpdateJobSettings}
                onConfigChange={shell.onConfigChange}
              />
            )}

            {activeStep === 2 && (
              <Step2ChapterReview
                key={currentJob.id}
                actionHost={chapterReviewActionHost}
                job={currentJob}
                onSaveChapters={handleSaveChapters}
                draftChapters={edit.chapterDraft?.jobId === currentJob.id ? edit.chapterDraft.chapters : undefined}
                onDraftChange={(jobId, chapters, hasEdits) => { edit.chapterDraft = { jobId, chapters, hasEdits }; }}
                onNextStep={() => setActiveStep(3)}
              />
            )}

            {activeStep === 3 && (
              <Step3Metadata
                actionHost={metadataReviewActionHost}
                job={currentJob}
                quickTags={config?.quick_tags || [...QUICK_ADD_CATEGORIES]} onAddQuickTag={handleAddQuickTag} onSaveMetadata={handleSaveMetadata}
                onWriteAudioMetadata={handleWriteProjectAudioMetadata} onUpdateJson={handleUpdateMetadataJson}
                onMoveExportFolder={handleMoveExportFolder}
                onPersistDraft={handlePersistMetadataDraft}
                draftMetadata={edit.metadataDraft?.jobId === currentJob.id ? edit.metadataDraft.metadata : undefined}
                onDraftChange={handleMetadataDraftChange}
                onRerunMetadata={() => handleRerunStep('metadata_processing')}
                isRerunning={isProcessingStep1}
                onNextStep={() => setActiveStep(4)}
              />
            )}

            {activeStep === 4 && (
              <Step4Export
                actionHost={convertActionHost}
                job={currentJob}
                config={config}
                onBuildM4b={handleBuildM4b}
                pendingChapterChanges={edit.chapterDraft?.jobId === currentJob.id && (edit.chapterDraft.hasEdits ?? chapterReviewChanged(edit.chapterDraft.chapters, currentJob.chapters))}
                isBuilding={isBuildingM4b}
                progressMessage={exportProgressMessage}
                error={exportError}
                onNextStep={runCheck => { setActiveStep(5); if (runCheck) void handleValidate().catch(() => {}); }}
              />
            )}

            {activeStep === 5 && (
              <Step5Validate
                job={currentJob}
                onNavigate={step => setActiveStep(step as 1 | 2 | 3 | 4 | 5)}
                onValidate={handleValidate}
                isValidating={isValidating}
                onFinish={handleFinishProcessing}
              />
            )}
          </>
        ) : (
          <LibraryManager
            catalog
            books={libraryBooks}
            onPlay={handlePlayLibraryBook}
            scanning={libraryScanning}
            scanWarning={libraryScanWarning}
            onOpen={async id => { await handleOpenProject(id, true); }}
            onSave={handleSaveLibraryMetadata}
            onWriteAudioMetadata={handleWriteLibraryAudioMetadata}
            onUpdateJson={handleUpdateLibraryJson}
            onMoveFolders={handleMoveLibraryFolders}
            onRelink={handleRelinkLibraryBook}
            onMoveToLibrary={(id, mode) => handleMoveInboxToLibrary(id, mode, true)}
            onOpenFolder={handleOpenLibraryFolder}
            onRefresh={() => handleRefreshLibrary()}
            onDelete={handleDeleteProject}
            onDeleteMany={handleDeleteMultiple}
          />
        )}
        </WorkflowLayout>
      </main>
  </>;
}
