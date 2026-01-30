import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, CheckCircle, XCircle, Clock, MessageSquare, Voicemail, AlertCircle, Activity, Zap, Server, Download, Loader2, ArrowUpRight, ArrowDownLeft, RefreshCw } from "lucide-react";
import { SiFacebook, SiTelegram } from "react-icons/si";
import type { CallLog, CallOutcome, ActivityLog, ActivityStats } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function getOutcomeConfig(outcome: CallOutcome): { icon: React.ReactNode; color: string; bgColor: string } {
  switch (outcome) {
    case "Booked":
      return { 
        icon: <CheckCircle className="h-4 w-4" />, 
        color: "text-emerald-600 dark:text-emerald-400",
        bgColor: "bg-emerald-50 dark:bg-emerald-950/30"
      };
    case "Interested":
      return { 
        icon: <Zap className="h-4 w-4" />, 
        color: "text-amber-600 dark:text-amber-400",
        bgColor: "bg-amber-50 dark:bg-amber-950/30"
      };
    case "Not Interested":
      return { 
        icon: <XCircle className="h-4 w-4" />, 
        color: "text-rose-600 dark:text-rose-400",
        bgColor: "bg-rose-50 dark:bg-rose-950/30"
      };
    case "No Answer":
      return { 
        icon: <Phone className="h-4 w-4" />, 
        color: "text-slate-500 dark:text-slate-400",
        bgColor: "bg-slate-50 dark:bg-slate-800/30"
      };
    case "Voicemail":
      return { 
        icon: <Voicemail className="h-4 w-4" />, 
        color: "text-violet-600 dark:text-violet-400",
        bgColor: "bg-violet-50 dark:bg-violet-950/30"
      };
    case "Needs Review":
      return { 
        icon: <AlertCircle className="h-4 w-4" />, 
        color: "text-orange-600 dark:text-orange-400",
        bgColor: "bg-orange-50 dark:bg-orange-950/30"
      };
    default:
      return { 
        icon: <Clock className="h-4 w-4" />, 
        color: "text-muted-foreground",
        bgColor: "bg-muted"
      };
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatTimestamp(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getServiceIcon(service: string): React.ReactNode {
  switch (service) {
    case "Facebook":
      return <SiFacebook className="h-4 w-4 text-blue-600" />;
    case "Telegram":
      return <SiTelegram className="h-4 w-4 text-sky-500" />;
    case "Attio":
      return <Server className="h-4 w-4 text-violet-500" />;
    case "Vapi":
      return <Phone className="h-4 w-4 text-emerald-500" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

function getActivityStatusBadge(status: string): React.ReactNode {
  if (status === "success") {
    return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">Success</Badge>;
  } else if (status === "failed") {
    return <Badge variant="secondary" className="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">Failed</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

interface ImportResult {
  status: string;
  total: number;
  processed: number;
  attioUpdated: number;
  errors: string[];
}

interface FacebookImportResult {
  status: string;
  total: number;
  created: number;
  skipped: number;
  errors: string[];
}

export default function Dashboard() {
  const { toast } = useToast();
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [fbImportResult, setFbImportResult] = useState<FacebookImportResult | null>(null);
  
  const { data: status } = useQuery<{ status: string; version: string; uptime: number }>({
    queryKey: ["/api/status"],
  });

  const { data: logs, isLoading: logsLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/logs"],
  });

  const { data: activityLogs, isLoading: activityLoading, refetch: refetchActivity } = useQuery<ActivityLog[]>({
    queryKey: ["/api/activity"],
    refetchInterval: 10000,
  });

  const { data: activityStats, refetch: refetchStats } = useQuery<ActivityStats>({
    queryKey: ["/api/activity/stats"],
    refetchInterval: 10000,
  });

  const importMutation = useMutation({
    mutationFn: async (hoursBack: number) => {
      const response = await apiRequest("POST", "/api/import-historical", { hoursBack });
      return response.json();
    },
    onSuccess: (data: ImportResult) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({
        title: "Import Complete",
        description: `Processed ${data.processed} calls, ${data.attioUpdated} Attio updates`,
      });
    },
    onError: (error) => {
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const fbImportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/import-facebook-leads", {});
      return response.json();
    },
    onSuccess: (data: FacebookImportResult) => {
      setFbImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity/stats"] });
      toast({
        title: "Facebook Import Complete",
        description: `Created ${data.created} leads, ${data.skipped} already exist`,
      });
    },
    onError: (error) => {
      toast({
        title: "Facebook Import Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const stats = logs ? {
    total: logs.length,
    booked: logs.filter(l => l.outcome === "Booked").length,
    interested: logs.filter(l => l.outcome === "Interested").length,
    noAnswer: logs.filter(l => l.outcome === "No Answer").length,
  } : { total: 0, booked: 0, interested: 0, noAnswer: 0 };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">ErzyCall Webhook Handler</h1>
            <p className="text-muted-foreground">Real-time Vapi call processing dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Online</span>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Calls</CardTitle>
              <Phone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Booked</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.booked}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Interested</CardTitle>
              <Zap className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.interested}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">No Answer</CardTitle>
              <Phone className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-500">{stats.noAnswer}</div>
            </CardContent>
          </Card>
        </div>

        {/* Status & Webhook Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Server Status
              </CardTitle>
              <CardDescription>Current system health and configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                  {status?.status || "Running"}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono text-sm">{status?.version || "1.0.0"}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Telegram</span>
                <Badge variant="secondary">Connected</Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Facebook</span>
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">Conversions API</Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Attio CRM</span>
                <Badge variant="secondary">Connected</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Webhook Endpoints
              </CardTitle>
              <CardDescription>Configure Vapi to send webhooks here</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Vapi Call Completion</p>
                <div className="p-2 rounded-md bg-muted font-mono text-sm break-all">
                  POST /webhook/vapi
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Facebook Lead Ads</p>
                <div className="p-2 rounded-md bg-muted font-mono text-sm break-all">
                  POST /webhook/facebook
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Import Historical Calls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Import Historical Calls
            </CardTitle>
            <CardDescription>Pull calls from Vapi and update Attio CRM with outcomes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                data-testid="button-import-24h"
                onClick={() => importMutation.mutate(24)}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Import Last 24 Hours
              </Button>
              <Button
                data-testid="button-import-48h"
                variant="outline"
                onClick={() => importMutation.mutate(48)}
                disabled={importMutation.isPending}
              >
                Import Last 48 Hours
              </Button>
              <Button
                data-testid="button-import-72h"
                variant="outline"
                onClick={() => importMutation.mutate(72)}
                disabled={importMutation.isPending}
              >
                Import Last 72 Hours
              </Button>
            </div>
            
            {importResult && (
              <div className="p-4 rounded-lg border border-border bg-muted/50 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <span className="font-medium">Import Complete</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Found:</span>
                    <span className="ml-2 font-medium">{importResult.total}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Processed:</span>
                    <span className="ml-2 font-medium">{importResult.processed}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Attio Updated:</span>
                    <span className="ml-2 font-medium text-emerald-600">{importResult.attioUpdated}</span>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="mt-2 text-sm text-rose-600">
                    {importResult.errors.length} errors occurred
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sync Facebook Leads */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SiFacebook className="h-5 w-5 text-blue-600" />
              Sync Facebook Leads
            </CardTitle>
            <CardDescription>Pull leads from Facebook Lead Ads and create missing records in Attio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                data-testid="button-sync-facebook-leads"
                onClick={() => fbImportMutation.mutate()}
                disabled={fbImportMutation.isPending}
              >
                {fbImportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Sync Facebook Leads to Attio
              </Button>
            </div>
            
            <p className="text-xs text-muted-foreground">
              Requires FACEBOOK_PAGE_ID environment variable to be set with your Facebook Page ID.
            </p>

            {fbImportResult && (
              <div className="p-4 rounded-lg border border-border bg-muted/50 space-y-2" data-testid="fb-import-result">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <span className="font-medium">Sync Complete</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Found:</span>
                    <span className="ml-2 font-medium" data-testid="fb-import-total">{fbImportResult.total}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <span className="ml-2 font-medium text-emerald-600" data-testid="fb-import-created">{fbImportResult.created}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Already Exist:</span>
                    <span className="ml-2 font-medium text-amber-600" data-testid="fb-import-skipped">{fbImportResult.skipped}</span>
                  </div>
                </div>
                {fbImportResult.errors.length > 0 && (
                  <div className="mt-2 text-sm text-rose-600" data-testid="fb-import-errors">
                    {fbImportResult.errors.length} errors occurred
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Log & Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Activity Stats */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Integration Stats
              </CardTitle>
              <CardDescription>Service activity statistics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-2xl font-bold">{activityStats?.total || 0}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                  <div className="text-2xl font-bold text-emerald-600">{activityStats?.successful || 0}</div>
                  <div className="text-xs text-muted-foreground">Success</div>
                </div>
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30">
                  <div className="text-2xl font-bold text-rose-600">{activityStats?.failed || 0}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>
              
              {activityStats?.byService && Object.keys(activityStats.byService).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">By Service</h4>
                  {Object.entries(activityStats.byService).map(([service, counts]) => (
                    <div key={service} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        {getServiceIcon(service)}
                        <span className="text-sm">{service}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-emerald-600">{counts.successful}</span>
                        <span className="text-muted-foreground">/</span>
                        <span>{counts.total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5" />
                    Service Activity Log
                  </CardTitle>
                  <CardDescription>Real-time data transfer between services</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    refetchActivity();
                    refetchStats();
                  }}
                  data-testid="button-refresh-activity"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : activityLogs && activityLogs.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {activityLogs.slice(0, 20).map((log) => (
                    <div
                      key={log.id}
                      data-testid={`activity-log-${log.id}`}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
                    >
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {log.direction === "incoming" ? (
                          <ArrowDownLeft className="h-3.5 w-3.5 text-blue-500" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                        {getServiceIcon(log.service)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{log.service}</span>
                          {getActivityStatusBadge(log.status)}
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{log.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Activity className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium">No activity yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Activity will appear here as services communicate
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Calls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Recent Calls
            </CardTitle>
            <CardDescription>Latest processed webhook events</CardDescription>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="space-y-3">
                {logs.slice(0, 10).map((log) => {
                  const config = getOutcomeConfig(log.outcome);
                  return (
                    <div
                      key={log.id}
                      data-testid={`call-log-${log.id}`}
                      className={`flex items-start gap-4 p-4 rounded-lg border border-border ${config.bgColor}`}
                    >
                      <div className={`mt-0.5 ${config.color}`}>
                        {config.icon}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{log.customerPhone}</span>
                          <Badge variant="outline" className={config.color}>
                            {log.outcome}
                          </Badge>
                          {log.duration > 0 && (
                            <span className="text-sm text-muted-foreground">
                              {formatDuration(log.duration)}
                            </span>
                          )}
                        </div>
                        {log.summary && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{log.summary}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{formatTimestamp(log.timestamp)}</span>
                          {log.telegramSent && (
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-3 w-3 text-emerald-500" />
                              Telegram sent
                            </span>
                          )}
                          {log.attioUpdated && (
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-3 w-3 text-emerald-500" />
                              Attio updated
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Phone className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="font-medium">No calls yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Calls will appear here when Vapi sends webhook events
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
