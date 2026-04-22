import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useApiQuery } from "@/hooks/useApiQuery";

export function ConnectionsPage() {
  const profiles = useApiQuery<any[]>(["connections"], "/connections");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Create / Edit Connection Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input placeholder="Profile name" />
          <Input placeholder="Hostname" />
          <Input placeholder="Port" defaultValue="1433" />
          <Input placeholder="Instance name" />
          <Select>
            <option>SQL Auth</option>
            <option>Windows Auth</option>
            <option>Entra ID Password</option>
            <option>Entra Service Principal</option>
            <option>Entra Managed Identity</option>
          </Select>
          <Input placeholder="Secret env key" />
          <Input placeholder="Tenant ID" />
          <Input placeholder="Client ID" />
          <Input placeholder="Database" />
          <Input placeholder="Connection timeout" defaultValue="30" />
          <div className="md:col-span-2">
            <Button>Save Profile</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Connection Profiles</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(profiles.data ?? []).map((profile) => (
            <div key={profile.ProfileId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="font-semibold text-white">{profile.Name}</p>
                <p className="text-xs text-slate-400">{profile.Hostname}:{profile.Port} ({profile.AuthType})</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm">Test</Button>
                <Button variant="ghost" size="sm">Edit</Button>
                <Button variant="danger" size="sm">Delete</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
