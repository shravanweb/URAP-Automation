import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { EmptyState, ErrorText, StatusBadge, buttonClass, inputClass } from '../components/ui.jsx';
import { SkeletonCards, SkeletonRows } from '../components/Loader.jsx';

const METRICS = [
  ['totalProjects', 'Projects'],
  ['activeProjects', 'Active projects'],
  ['totalWorkflows', 'Workflows'],
  ['enabledWorkflows', 'Enabled workflows'],
  ['queuedJobs', 'Queued jobs'],
  ['runningJobs', 'Running jobs'],
  ['suspendedJobs', 'Waiting for people'],
  ['successfulExecutions', 'Successful executions'],
  ['failedExecutions', 'Failed executions'],
];

export default function DashboardPage() {
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ projectId: '', from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState([]);

  async function load(next = filters) {
    const params = new URLSearchParams();
    if (next.projectId) params.set('projectId', next.projectId);
    if (next.from) params.set('from', new Date(next.from).toISOString());
    if (next.to) params.set('to', new Date(next.to).toISOString());
    const [result, notes] = await Promise.all([api(`/api/dashboard?${params.toString()}`), api('/api/notifications?limit=10')]);
    setData(result.data);
    setNotifications(notes.data);
  }

  useEffect(() => {
    api('/api/projects?limit=100').then((result) => setProjects(result.data)).catch((err) => setError(err.message));
    load().catch((err) => setError(err.message));
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Dashboard</h1><p className="text-sm text-muted">Counts come from the database for the projects you can access.</p></div>
        <button className={buttonClass} type="button" onClick={() => load().catch((err) => setError(err.message))}>Refresh</button>
      </div>
      <form className="grid gap-2 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(err.message)); }}>
        <select className={inputClass} value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
          <option value="">All accessible projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <input className={inputClass} type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        <input className={inputClass} type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        <button className={buttonClass} type="submit">Apply filters</button>
      </form>
      <ErrorText>{error}</ErrorText>
      {!data ? (error ? null : <div className="space-y-4"><SkeletonCards count={4} /><SkeletonRows rows={4} cols={3} label="Loading metrics" /></div>) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {METRICS.map(([key, label]) => (
              <article key={key} className="rounded-lg border border-line bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{data[key]}</p>
              </article>
            ))}
          </div>
          <article className="rounded-lg border border-line bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Average execution duration</p>
            <p className="mt-1 text-2xl font-semibold">{data.averageExecutionDurationMs == null ? 'No completed executions' : `${Math.round(data.averageExecutionDurationMs)} ms`}</p>
          </article>
          {data.totalProjects === 0 ? <EmptyState title="No projects yet" body="Create a project to start configuring workflows." /> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h2 className="mb-2 font-semibold">Recent activity</h2>
                {data.recentActivity.length === 0 ? <EmptyState title="No activity" body="Creates, publishes, and runs will appear here." /> : (
                  <ul className="divide-y divide-line rounded-lg border border-line bg-white">{data.recentActivity.map((item) => <li key={item.id} className="px-3 py-2 text-sm">{item.action}<span className="block text-muted">{item.created_at}</span></li>)}</ul>
                )}
              </div>
              <div>
                <h2 className="mb-2 font-semibold">Recent errors</h2>
                {data.recentErrors.length === 0 ? <EmptyState title="No failed attempts" body="Failed step and job attempts will appear here." /> : (
                  <ul className="divide-y divide-line rounded-lg border border-line bg-white">{data.recentErrors.map((item) => <li key={item.id} className="px-3 py-2 text-sm"><StatusBadge status="FAILED" /> <Link className="text-emberdark" to={`/jobs/${item.job_id}`}>job {item.job_id.slice(0, 8)}</Link> attempt {item.attempt_number}: {item.error_message}</li>)}</ul>
                )}
              </div>
              <div>
                <h2 className="mb-2 font-semibold">Executions by day</h2>
                {data.trends.length === 0 ? <EmptyState title="No executions" body="Daily job counts appear after the first run." /> : (
                  <ul className="divide-y divide-line rounded-lg border border-line bg-white">{Object.entries(data.trends.reduce((acc, row) => { const day = String(row.day).slice(0, 10); acc[day] = { ...(acc[day] || {}), [row.status]: Number(row.count) }; return acc; }, {})).slice(0, 10).map(([day, counts]) => <li key={day} className="px-3 py-2 text-sm"><span className="font-medium">{day}</span> · {Object.entries(counts).map(([status, count]) => `${status.toLowerCase()} ${count}`).join(' · ')}</li>)}</ul>
                )}
              </div>
              <div>
                <h2 className="mb-2 font-semibold">Notifications</h2>
                {notifications.length === 0 ? <EmptyState title="No notifications" body="Send Notification activities with the in-app channel post here." /> : (
                  <ul className="divide-y divide-line rounded-lg border border-line bg-white">{notifications.map((item) => <li key={item.id} className="px-3 py-2 text-sm"><span className="font-medium">{item.subject}</span> · {item.body}<span className="block text-muted">{item.created_at}</span></li>)}</ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
