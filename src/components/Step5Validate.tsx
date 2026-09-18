import React from 'react';
import { AudiobookJob } from '../types';
import { useDependencyStatus } from '../dependency-status';
export const Step5Validate: React.FC<{job:AudiobookJob;onValidate:()=>Promise<void>;isValidating:boolean}> = ({job,onValidate,isValidating}) => {
  const validationAvailability = useDependencyStatus().feature('output_validation');
  return <div className="bg-white border rounded-xl p-6 space-y-4">
  <h2 className="text-lg font-bold">Check your exported audiobook</h2>
  <p className="text-sm text-stone-600">SwissMouse reads the newest export and compares its duration, chapter names, and timestamps with your saved chapter list. This checks the file itself; listen in your preferred player to confirm navigation.</p>
  <button className="bg-amber-600 text-white rounded px-4 py-2 disabled:opacity-40" title={validationAvailability.tooltip || 'Read the exported file and compare its chapters with the saved list'} disabled={!validationAvailability.ready || isValidating || !job.outputM4b} onClick={onValidate}>{isValidating ? 'Checking file…' : 'Check exported file'}</button>
  {job.validation && <div className="border rounded p-4">
    <strong>{job.validation.status}: {job.validation.file}</strong>
    <p>{job.validation.duration_seconds.toFixed(3)} seconds · {job.validation.chapters_count} chapter markers · {job.validation.size_mb} MB</p>
    <p>{job.validation.reason}</p>
  </div>}
</div>;
};
