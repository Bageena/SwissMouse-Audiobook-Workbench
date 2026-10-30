import * as React from 'react';
import { createBookInformation } from '../../packages/audiobooks/src/BookInformation';

// Temporary built-in compatibility adapter during extraction.
export const BookInformation = createBookInformation(React);
