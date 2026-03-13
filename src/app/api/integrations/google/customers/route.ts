import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection } from '@/lib/platform/connections';
import { decrypt } from '@/lib/crypto';

export type GoogleCustomer = {
  id: string;   // numeric customer ID
  name: string; // descriptive name
};

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);

    const conn = await getConnection(ctx.workspaceId, 'google');
    if (!conn || !conn.accessTokenEncrypted) {
      return apiOk({ customers: [] });
    }

    const accessToken = decrypt(conn.accessTokenEncrypted);
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

    if (!developerToken) {
      return apiOk({ customers: [], error: 'Google Ads developer token not configured' });
    }

    // List all accessible customer IDs
    const listRes = await fetch(
      'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': developerToken,
        },
      },
    );
    const listData = await listRes.json();

    if (!listRes.ok || !listData.resourceNames) {
      return apiOk({ customers: [], error: listData.error?.message || 'Failed to list customers' });
    }

    // Fetch names for each customer (in parallel, best-effort)
    const resourceNames: string[] = listData.resourceNames;
    const customers = await Promise.all(
      resourceNames.map(async (rn: string): Promise<GoogleCustomer> => {
        const customerId = rn.replace('customers/', '');
        try {
          const infoRes = await fetch(
            `https://googleads.googleapis.com/v18/customers/${customerId}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'developer-token': developerToken,
                'login-customer-id': customerId,
              },
            },
          );
          const infoData = await infoRes.json();
          return {
            id: customerId,
            name: infoData.descriptiveName || infoData.id || customerId,
          };
        } catch {
          return { id: customerId, name: customerId };
        }
      }),
    );

    return apiOk({ customers });
  } catch (error) {
    return apiError(error);
  }
}
