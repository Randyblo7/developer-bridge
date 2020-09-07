import {
  AuthorizationServiceConfiguration,
} from '@openid/appauth/built/authorization_service_configuration';
import { AppAuthError } from '@openid/appauth/built/errors';
import { RevokeTokenRequest } from '@openid/appauth/built/revoke_token_request';
import {
  ErrorType,
  TokenError,
  TokenResponse,
} from '@openid/appauth/built/token_response';
import {
  TokenRequestHandler,
} from '@openid/appauth/built/token_request_handler';
import { BasicQueryStringUtils } from '@openid/appauth/built/query_string_utils';
import * as t from 'io-ts';

import fetch from '../fetch';

// Fitbit's error responses are non-standard per
// https://tools.ietf.org/html/rfc6749#section-5.2
// tslint:disable-next-line:variable-name
const FitbitAuthErrorResponse = t.interface({
  errors: t.array(
    t.interface({
      errorType: t.string,
      message: t.string,
    }),
  ),
  success: t.boolean,
});
type FitbitAuthErrorResponse = t.TypeOf<typeof FitbitAuthErrorResponse>;

// tslint:disable-next-line:variable-name
const FitbitTokenResponse = t.interface({
  access_token: t.string,
  refresh_token: t.string,
  expires_in: t.number,
  token_type: t.union([
    t.literal('bearer'),
    t.literal('mac'),
    t.undefined,
  ]),
});
export type FitbitTokenResponse = t.TypeOf<typeof FitbitTokenResponse>;

const commonParams = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
};

export default class FitbitTokenRequestHandler implements TokenRequestHandler {
  public readonly utils = new BasicQueryStringUtils();

  performRevokeTokenRequest(
    configuration: AuthorizationServiceConfiguration,
    request: RevokeTokenRequest,
  ): Promise<boolean> {
    return fetch(
      configuration.revocationEndpoint,
      {
        ...commonParams,
        body: this.utils.stringify({
          token: request.token,
        }),
      },
    ).then(response => response.ok);
  }

  async performTokenRequest(
    configuration: AuthorizationServiceConfiguration,
    request: {
      toStringMap: () => Record<string, string>,
    },
  ): Promise<TokenResponse> {
    const response = await fetch(
      configuration.tokenEndpoint,
      {
        ...commonParams,
        body: this.utils.stringify(request.toStringMap()),
      },
    );
    const responseJson = await response.json();

    // AppAuth types insist this is lower case, but it's title-cased by Fitbit
    if (responseJson.token_type) responseJson.token_type = responseJson.token_type.toLowerCase();

    if (response.status === 200 && FitbitTokenResponse.is(responseJson)) {
      return new TokenResponse({
        ...responseJson,
        expires_in: String(responseJson.expires_in),
      });
    }

    if (FitbitAuthErrorResponse.is(responseJson)) {
      const error = responseJson.errors[0];
      throw new AppAuthError(
        error.errorType,
        new TokenError({
          error: error.errorType as ErrorType,
          error_description: error.message,
        }),
      );
    }

    throw new AppAuthError(
      `Unexpected response format for status ${response.status}: ${JSON.stringify(responseJson)}`,
    );
  }
}
