const HttpMethod = require('./enums').HttpMethod;
const Rack = require('../rack/rack');
const Response = require('./response');
const ResponseType = require('./enums').ResponseType;
const Query = require('./query');
const url = require('url');
const Client = require('./client');
const DataPolicy = require('./enums').DataPolicy;
const StatusCode = require('./enums').StatusCode;
const KinveyError = require('./errors').KinveyError;
const BlobNotFoundError = require('./errors').BlobNotFoundError;
const NotFoundError = require('./errors').NotFoundError;
const RequestProperties = require('./requestProperties');
const Promise = require('bluebird');
const UrlPattern = require('url-pattern');
const qs = require('qs');
const assign = require('lodash/object/assign');
const result = require('lodash/object/result');
const clone = require('lodash/lang/clone');
const indexBy = require('lodash/collection/indexBy');
const reduce = require('lodash/collection/reduce');
const forEach = require('lodash/collection/forEach');
const byteCount = require('./utils/string').byteCount;
const isArray = require('lodash/lang/isArray');
const isFunction = require('lodash/lang/isFunction');
const isString = require('lodash/lang/isString');
const isPlainObject = require('lodash/lang/isPlainObject');
const syncCollectionName = process.env.KINVEY_SYNC_COLLECTION_NAME || 'sync';
const customRequestPropertiesMaxBytes = process.env.KINVEY_MAX_HEADER_BYTES || 2000;
const defaultTimeout = process.env.KINVEY_DEFAULT_TIMEOUT || 10000;
const maxIdsPerRequest = process.env.KINVEY_MAX_IDS || 200;

class Request {
  constructor(options = {}) {
    options = assign({
      method: HttpMethod.GET,
      pathname: '/',
      query: null,
      search: null,
      data: null,
      auth: null,
      client: Client.sharedInstance(),
      dataPolicy: DataPolicy.LocalFirst,
      responseType: ResponseType.Text,
      timeout: defaultTimeout,
      skipSync: false
    }, options);

    if (!(options.client instanceof Client)) {
      options.client = new Client(result(options.client, 'toJSON', options.client));
    }

    this.method = options.method;
    this.headers = {};
    this.requestProperties = options.requestProperties;
    this.protocol = options.client.apiProtocol;
    this.host = options.client.apiHost;
    this.pathname = options.pathname || options.path;
    this.query = options.query;
    this.search = qs.parse(options.search);
    this.data = options.data;
    this.responseType = options.responseType;
    this.client = options.client;
    this.auth = options.auth;
    this.dataPolicy = options.dataPolicy;
    this.timeout = options.timeout;
    this.executing = false;
    this.skipSync = options.skipSync;

    const headers = {};
    headers.Accept = 'application/json';
    headers['X-Kinvey-Api-Version'] = process.env.KINVEY_API_VERSION || 3;
    headers['X-Kinvey-Device-Information'] = 'nodejs-sdk v1.9.0';

    if (options.contentType) {
      headers['X-Kinvey-Content-Type'] = options.contentType;
    }

    if (options.skipBL === true) {
      headers['X-Kinvey-Skip-Business-Logic'] = true;
    }

    if (options.trace === true) {
      headers['X-Kinvey-Include-Headers-In-Response'] = 'X-Kinvey-Request-Id';
      headers['X-Kinvey-ResponseWrapper'] = true;
    }

    this.addHeaders(headers);
  }

  get method() {
    return this._method;
  }

  set method(method) {
    if (!isString(method)) {
      method = String(method);
    }

    method = method.toUpperCase();

    switch (method) {
    case HttpMethod.GET:
    case HttpMethod.POST:
    case HttpMethod.PATCH:
    case HttpMethod.PUT:
    case HttpMethod.DELETE:
      this._method = method;
      break;
    default:
      throw new KinveyError('Invalid Http Method. GET, POST, PATCH, PUT, and DELETE are allowed.');
    }
  }

  get requestProperties() {
    return this._requestProperties;
  }

  set requestProperties(requestProperties) {
    if (!(requestProperties instanceof RequestProperties)) {
      requestProperties = new RequestProperties(result(requestProperties, 'toJSON', requestProperties));
    }

    const appVersion = requestProperties.appVersion;

    if (appVersion) {
      this.setHeader('X-Kinvey-Client-App-Version', appVersion);
    } else {
      this.removeHeader('X-Kinvey-Client-App-Version');
    }

    const customRequestProperties = result(requestProperties, 'toJSON', {});
    delete customRequestProperties.appVersion;
    const customRequestPropertiesHeader = JSON.stringify(requestProperties.toJSON());
    const customRequestPropertiesByteCount = byteCount(customRequestPropertiesHeader);

    if (customRequestPropertiesByteCount >= customRequestPropertiesMaxBytes) {
      throw new KinveyError(
        `The custom request properties are ${customRequestPropertiesByteCount} bytes.` +
        `It must be less then ${customRequestPropertiesMaxBytes} bytes.`,
        'Please remove some custom request properties.');
    }

    this.setHeader('X-Kinvey-Custom-Request-Properties', customRequestPropertiesHeader);
    this._requestProperties = requestProperties;
  }

  get url() {
    return url.format({
      protocol: this.protocol,
      host: this.host,
      pathname: this.pathname
    });
  }

  get body() {
    return this.data;
  }

  set body(body) {
    this.data = body;
  }

  get data() {
    return this._data;
  }

  set data(data) {
    if (data) {
      const contentTypeHeader = this.getHeader('Content-Type');
      if (!contentTypeHeader) {
        this.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
    } else {
      this.removeHeader('Content-Type');
    }

    this._data = data;
  }

  get responseType() {
    return this._responseType;
  }

  set responseType(type) {
    type = type || ResponseType.DOMString;
    let responseType;

    switch (type) {
    case ResponseType.Blob:
      try {
        responseType = new global.Blob() && 'blob';
      } catch (e) {
        responseType = 'arraybuffer';
      }

      break;
    case ResponseType.Document:
      responseType = 'document';
      break;
    case ResponseType.JSON:
      responseType = 'json';
      break;
    default:
      responseType = '';
    }

    this._responseType = responseType;
  }

  get query() {
    return this._query;
  }

  set query(query) {
    this._query = result(query, 'toJSON', query);
  }

  getHeader(header) {
    if (!isString(header)) {
      header = String(header);
    }

    const keys = Object.keys(this.headers);

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];

      if (key.toLowerCase() === header.toLowerCase()) {
        return this.headers[key];
      }
    }

    return undefined;
  }

  setHeader(header, value) {
    if (!isString(header)) {
      header = String(header);
    }

    const headers = this.headers;
    headers[header] = value;
    this.headers = headers;
  }

  addHeaders(headers) {
    if (!isPlainObject(headers)) {
      throw new KinveyError('headers argument must be an object');
    }

    const keys = Object.keys(headers);

    keys.forEach((header) => {
      const value = headers[header];
      this.setHeader(header, value);
    });
  }

  removeHeader(header) {
    delete this.headers[header.toLowerCase()];
  }

  clearHeaders() {
    this.headers = {};
  }

  execute() {
    if (this.executing) {
      return Promise.reject(new KinveyError('The request is already executing.'));
    }

    const promise = Promise.resolve();
    const auth = this.auth;
    this.executing = true;

    return promise.then(() => {
      return isFunction(auth) ? auth(this.client) : auth;
    }).then(authInfo => {
      if (authInfo) {
        let credentials = authInfo.credentials;
        if (authInfo.username) {
          credentials = new Buffer(`${authInfo.username}:${authInfo.password}`).toString('base64');
        }

        this.setHeader('Authorization', `${authInfo.scheme} ${credentials}`);
      }
    }).then(() => {
      if (this.dataPolicy === DataPolicy.ForceLocal) {
        return this.executeLocal().then(response => {
          if (!this.skipSync && this.method !== HttpMethod.GET && response && response.isSuccess()) {
            return this.notifySync(response.data).then(() => {
              return response;
            });
          }

          return response;
        });
      } else if (this.dataPolicy === DataPolicy.PreferLocal) {
        if (this.method !== HttpMethod.GET) {
          const request = new Request({
            method: this.method,
            pathname: this.pathname,
            query: this.query,
            auth: this.auth,
            data: this.data,
            client: this.client,
            dataPolicy: DataPolicy.PreferNetwork
          });
          return request.execute().catch(err => {
            const request2 = new Request({
              method: this.method,
              pathname: this.pathname,
              query: this.query,
              auth: this.auth,
              data: this.data,
              client: this.client,
              dataPolicy: DataPolicy.ForceLocal
            });
            return request2.execute().then(() => {
              throw err;
            });
          });
        }

        return this.executeLocal().catch(err => {
          if (err instanceof NotFoundError) {
            return new Response(StatusCode.NotFound, {}, []);
          }

          throw err;
        }).then(response => {
          if (response && !response.isSuccess()) {
            const request = new Request({
              method: this.method,
              pathname: this.pathname,
              query: this.query,
              auth: this.auth,
              data: response.data,
              client: this.client,
              dataPolicy: DataPolicy.PreferNetwork
            });
            return request.execute();
          }

          return response;
        });
      } else if (this.dataPolicy === DataPolicy.ForceNetwork) {
        return this.executeNetwork();
      } else if (this.dataPolicy === DataPolicy.PreferNetwork) {
        return this.executeNetwork().then(response => {
          if (response && response.isSuccess()) {
            const request = new Request({
              method: this.method,
              pathname: this.pathname,
              query: this.query,
              auth: this.auth,
              data: response.data,
              client: this.client,
              dataPolicy: DataPolicy.ForceLocal
            });

            if (this.method === HttpMethod.GET) {
              request.method = HttpMethod.PUT;
            }

            return request.execute().then(() => {
              return response;
            });
          } else if (this.method === HttpMethod.GET) {
            const request = new Request({
              method: this.method,
              pathname: this.pathname,
              query: this.query,
              auth: this.auth,
              data: response.data,
              client: this.client,
              dataPolicy: DataPolicy.ForceLocal
            });
            return request.execute();
          }

          return response;
        });
      }
    }).then(response => {
      if (!response) {
        throw new KinveyError('No response');
      } else if (!response.isSuccess()) {
        const data = response.data || {
          name: 'KinveyError',
          message: 'An error has occurred.',
          debug: ''
        };

        data.message = data.message || data.description || data.error;

        if (data.name === 'BlobNotFound') {
          throw new BlobNotFoundError(data.message, data.debug);
        } else if (data.name === 'EntityNotFound') {
          throw new NotFoundError(data.message, data.debug);
        }

        throw new KinveyError(data.message, data.debug);
      }

      this.response = response;
      return response;
    }).catch(err => {
      this.response = null;
      throw err;
    }).finally(() => {
      this.executing = false;
    });
  }

  executeLocal() {
    const rack = Rack.cacheRack;
    return rack.execute(this.toJSON());
  }

  executeNetwork() {
    const rack = Rack.networkRack;
    return rack.execute(this.toJSON());
  }

  /**
   * {
    _id = 'books',
    documents = {
      '1231uhds089kjhsd0923': {
        operation: 'POST',
        requestProperties: ...
      }
    },
    size: 1
  }
   */
  notifySync(data = []) {
    const pattern = new UrlPattern('/:namespace/:appId/:collection(/)(:id)(/)');
    const matches = pattern.match(this.pathname);
    const getRequest = new Request({
      method: HttpMethod.GET,
      pathname: `/${matches.namespace}/${matches.appId}/${syncCollectionName}/${matches.collection}`,
      auth: this.auth,
      client: this.client,
      dataPolicy: DataPolicy.LocalOnly
    });

    const promise = getRequest.execute().catch(() => {
      return new Response(StatusCode.OK, {}, {
        _id: matches.collection,
        documents: {},
        size: 0
      });
    }).then(response => {
      const syncCollection = response.data || {
        _id: matches.collection,
        documents: {},
        size: 0
      };
      const documents = syncCollection.documents;
      let size = syncCollection.size;

      if (!isArray(data)) {
        data = [data];
      }

      forEach(data, item => {
        if (item._id) {
          if (!documents.hasOwnProperty(item._id)) {
            size = size + 1;
          }

          documents[item._id] = {
            request: this.toJSON(),
            lmt: item._kmd ? item._kmd.lmt : null
          };
        }
      });

      syncCollection.documents = documents;
      syncCollection.size = size;

      const updateRequest = new Request({
        method: HttpMethod.PUT,
        pathname: `/${matches.namespace}/${matches.appId}/${syncCollectionName}/${matches.collection}`,
        auth: this.auth,
        data: syncCollection,
        client: this.client,
        dataPolicy: DataPolicy.LocalOnly,
        skipSync: true
      });
      return updateRequest.execute();
    }).then(() => {
      return null;
    });

    return promise;
  }

  abort() {
    // TODO
    throw new KinveyError('Method not supported');
  }

  toJSON() {
    const json = {
      method: this.method,
      headers: this.headers,
      url: this.url,
      pathname: this.pathname,
      query: this.query,
      search: this.search,
      data: this.data,
      responseType: this.responseType,
      timeout: this.timeout
    };

    return clone(json);
  }
}

class DeltaSetRequest extends Request {
  execute() {
    if (this.executing) {
      return Promise.reject(new KinveyError('The request is already executing.'));
    }

    if (this.dataPolicy === DataPolicy.PreferNetwork && this.method === HttpMethod.GET) {
      const promise = Promise.resolve();
      const auth = this.auth;
      this.executing = true;

      return promise.then(() => {
        return isFunction(auth) ? auth(this.client) : auth;
      }).then(authInfo => {
        if (authInfo) {
          let credentials = authInfo.credentials;
          if (authInfo.username) {
            credentials = new Buffer(`${authInfo.username}:${authInfo.password}`).toString('base64');
          }

          this.setHeader('Authorization', `${authInfo.scheme} ${credentials}`);
        }
      }).then(() => {
        const origQuery = this.query;
        const query = new Query();
        query.fields(['_id', '_kmd']);
        this.query = query;
        this.executing = true;

        return this.executeLocal().catch(err => {
          if (err instanceof NotFoundError) {
            return new Response(StatusCode.Ok, {}, []);
          }

          throw err;
        }).then(localResponse => {
          if (localResponse && localResponse.isSuccess()) {
            const localDocuments = indexBy(localResponse.data, '_id');

            return this.executeNetwork().then(networkResponse => {
              if (networkResponse && networkResponse.isSuccess()) {
                const networkDocuments = indexBy(networkResponse.data, '_id');

                for (const id in networkDocuments) {
                  if (networkDocuments.hasOwnProperty(id)) {
                    const networkDocument = networkDocuments[id];
                    const localDocument = localDocuments[id];

                    // Push id onto delta set if local document doesn't exist
                    if (networkDocument && !localDocument) {
                      continue;
                    } else if (networkDocument && localDocument) {
                      // Push id onto delta set if lmt differs
                      if (networkDocument._kmd && localDocument._kmd && networkDocument._kmd.lmt > localDocument._kmd.lmt) {
                        continue;
                      }
                    }

                    delete networkDocuments[id];
                  }
                }

                const networkIds = Object.keys(networkDocuments);
                const promises = [];
                let i = 0;

                console.log('Network Ids:' + networkIds);

                // Batch the requests to retrieve 200 items per request
                while (i < networkIds.length) {
                  const query = new Query(result(origQuery, 'toJSON', origQuery));
                  query.contains('_id', networkIds.slice(i, networkIds.length > maxIdsPerRequest + i ? maxIdsPerRequest : networkIds.length));

                  const request = new Request({
                    method: this.method,
                    pathname: this.pathname,
                    auth: this.auth,
                    client: this.client,
                    dataPolicy: DataPolicy.PreferNetwork,
                    query: query
                  });

                  if (origQuery) {
                    const query = new Query(result(origQuery, 'toJSON', origQuery));
                    query.contains('_id', networkIds.slice(i, networkIds.length > maxIdsPerRequest + i ? maxIdsPerRequest : networkIds.length));
                    request.query = query;
                  }

                  promises.push(request.execute());
                  i += maxIdsPerRequest;
                }

                const localIds = Object.keys(localDocuments);
                i = 0;

                console.log('Local Ids:' + localIds);


                while (i < localIds.length) {
                  const query = new Query(result(origQuery, 'toJSON', origQuery));
                  query.contains('_id', localIds.slice(i, localIds.length > maxIdsPerRequest + i ? maxIdsPerRequest : localIds.length));

                  const request = new Request({
                    method: this.method,
                    pathname: this.pathname,
                    auth: this.auth,
                    client: this.client,
                    dataPolicy: DataPolicy.ForceLocal,
                    query: query
                  });

                  promises.push(request.execute());
                  i += maxIdsPerRequest;
                }

                // Reduce all the responses into one response
                return Promise.all(promises).then(responses => {
                  const initialResponse = new Response(StatusCode.Ok, {}, []);
                  return reduce(responses, (result, response) => {
                    if (response.headers) {
                      result.addHeaders(response.headers);
                    }

                    result.data = result.data.concat(response.data);
                    return result;
                  }, initialResponse);
                }).finally(() => {
                  this.executing = false;
                  this.query = origQuery;
                });
              }

              this.executing = false;
              return super.execute();
            });
          }

          this.executing = false;
          return super.execute();
        });
      });
    }

    return super.execute();
  }
}

module.exports = {
  Request: Request,
  DeltaSetRequest: DeltaSetRequest
};
