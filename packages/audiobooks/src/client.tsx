import type { BrowserSdk, BrowserContribution, ModulePanelProps } from '@swissmouse/sdk';
import { createBookInformation, type BookInformationMetadata } from './BookInformation';

export function activate(sdk: BrowserSdk): BrowserContribution {
  const React = sdk.React;
  const Information = createBookInformation(React);
  const Panel = sdk.ui.Panel;
  function InformationPanel({ data }: ModulePanelProps) {
    const summary = data as { id: string; title: string; metadata: BookInformationMetadata };
    // A hook intentionally exercises the host runtime when mounted.
    const labelId = React.useId();
    return <Panel id="audiobooks.information" title="Book information">
      <div className="audiobooks-installed-information" aria-labelledby={labelId}>
        <img src={sdk.assetUrl('book.svg')} width="24" height="24" alt="" />
        <span id={labelId} className="audiobooks-installed-caption">Saved book information</span>
        <Information metadata={summary.metadata} fallbackTitle={summary.title} />
      </div>
    </Panel>;
  }
  return { panels: { 'audiobooks.information': InformationPanel } };
}
