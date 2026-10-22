export interface CloudPlanSyncFailurePolicy {
  code:string;
  status:number|null;
  category:'permanent'|'authentication'|'cancelled'|'service'|'network';
  retryable:boolean;
  retryAfterMs:number;
  silent:boolean;
}
export function cloudPlanSyncFailurePolicy(error:unknown):CloudPlanSyncFailurePolicy;
