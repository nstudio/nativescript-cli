import isPlainObject from 'lodash/isPlainObject';

/**
 * This class provides a way to access the KMD (Kinvey Metadata)
 * information for an entity.
 */
export default class Kmd {
  constructor(entity = {}) {
    if (!isPlainObject(entity)) {
      throw new Error('entity must be a plain object.');
    }

    entity._kmd = entity._kmd || {};
    this.entity = entity;
  }

  /**
   * Get the auth token.
   *
   * @returns {string} _kmd.authtoken
   */
  get authtoken() {
    return this.entity._kmd.authtoken;
  }

  /**
   * Get created at time.
   *
   * @returns {Date?} _kmd.ect
   */
  get ect() {
    return this.createdAt;
  }

  /**
   * Get created at time.
   *
   * @returns {Date?} _kmd.ect
   */
  get createdAt() {
    if (this.entity._kmd.ect) {
      return new Date(this.entity._kmd.ect);
    }

    return undefined;
  }

  /**
   * Get last modified time.
   *
   * @returns {Date?} _kmd.lmt
   */
  get lmt() {
    return this.updatedAt;
  }

  /**
   * Get last modified time.
   *
   * @returns {Date?} _kmd.lmt
   */
  get lastModified() {
    return this.updatedAt;
  }

  /**
   * Get last modified time.
   *
   * @returns {Date?} _kmd.lmt
   */
  get updatedAt() {
    if (this.entity._kmd.lmt) {
      return new Date(this.entity._kmd.lmt);
    }

    return undefined;
  }

  /**
   * Get the email verification details.
   *
   * @returns {Object} _kmd.emailVerification
   */
  get emailVerification() {
    return this.entity._kmd.emailVerification;
  }

  /**
   * Checks if an email for a user has been confirmed.
   *
   * @returns {boolean} True if the email has been confirmed otherwise false
   */
  isEmailConfirmed() {
    if (this.emailVerification) {
      return this.emailVerification.status === 'confirmed';
    }

    return false;
  }

  /**
   * Checks if the entity has been created locally.
   *
   * @returns {boolean} True if the entity has been created locally otherwise false
   */
  isLocal() {
    return this.entity._kmd.local === true;
  }
}
