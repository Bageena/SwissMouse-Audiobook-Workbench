export { createRequirementRegistry } from '../../packages/sdk/dependencies';
export type { RequirementDetails } from '../../packages/sdk/dependencies';
import { createRequirementRegistry } from '../../packages/sdk/dependencies';
export const requirementsRegistry=createRequirementRegistry();
export const requirementDetails=requirementsRegistry.details;
