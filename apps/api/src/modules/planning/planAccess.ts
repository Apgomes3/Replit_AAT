// Who may see and change a plan (pure rules; the facts come from drafting/repository getPlanAccessFacts).
//
//   see:  admins; the owner, people the plan is shared with and task assignees;
//         for a 'team' plan everyone in its team (and the team manager); for 'everyone' plans any user;
//         Drafting module users see Drafting department team plans.
//   edit: admins, the owner, people the plan is shared with, the team manager;
//         Drafting module managers edit Drafting department team plans.
// Listing uses the matching SQL condition in drafting/repository (visibleTo).
import type { PlanAccessFacts } from '../drafting/repository';

export type PlanViewer = {
  role: string;
  /** Drafting module access for the user's role: 'manage', 'view' or 'hidden'. */
  drafting?: 'manage' | 'view' | 'hidden' | null;
};

const isDraftingPlan = (f: PlanAccessFacts) => f.department?.toLowerCase() === 'drafting';

export function canViewPlan(f: PlanAccessFacts, user: PlanViewer): boolean {
  if (user.role === 'admin') return true;
  if (f.is_owner || f.is_member || f.is_assignee) return true;
  if (f.visibility === 'everyone') return true;
  if (f.visibility === 'team' && (f.is_team_member || f.is_team_manager)) return true;
  return isDraftingPlan(f) && !!user.drafting && user.drafting !== 'hidden';
}

export function canEditPlan(f: PlanAccessFacts, user: PlanViewer): boolean {
  if (user.role === 'admin') return true;
  if (f.is_owner || f.is_member || f.is_team_manager) return true;
  return isDraftingPlan(f) && user.drafting === 'manage';
}
