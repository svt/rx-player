/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { combineLatest as observableCombineLatest, concat as observableConcat, defer as observableDefer, EMPTY, merge as observableMerge, of as observableOf, } from "rxjs";
import { catchError, filter, ignoreElements, map, mergeMap, tap, } from "rxjs/operators";
import { events, generateKeyRequest, shouldUnsetMediaKeys, } from "../../compat/";
import { EncryptedMediaError } from "../../errors";
import log from "../../log";
import { assertInterface } from "../../utils/assert";
import noop from "../../utils/noop";
import attachMediaKeys from "./attach_media_keys";
import disposeMediaKeys from "./dispose_media_keys";
import getMediaKeysInfos from "./get_media_keys";
import getSession from "./get_session";
import handleSessionEvents from "./handle_session_events";
import MediaKeysInfosStore from "./media_keys_infos_store";
import setServerCertificate from "./set_server_certificate";
import InitDataStore from "./utils/init_data_store";
var onEncrypted$ = events.onEncrypted$;
var attachedMediaKeysInfos = new MediaKeysInfosStore();
/**
 * Clear EME ressources that should be cleared when the current content stops
 * its playback.
 * @returns {Observable}
 */
function clearEMESession(mediaElement) {
    return observableDefer(function () {
        if (shouldUnsetMediaKeys()) {
            return disposeMediaKeys(mediaElement, attachedMediaKeysInfos)
                .pipe(ignoreElements());
        }
        var currentState = attachedMediaKeysInfos.getState(mediaElement);
        if (currentState && currentState.keySystemOptions.closeSessionsOnStop) {
            return currentState.sessionsStore.closeAllSessions()
                .pipe(ignoreElements());
        }
        return EMPTY;
    });
}
/**
 * EME abstraction and event handler used to communicate with the Content-
 * Description-Module (CDM).
 *
 * The EME handler can be given one or multiple systems and will choose the
 * appropriate one supported by the user's browser.
 * @param {HTMLMediaElement} mediaElement
 * @param {Array.<Object>} keySystems
 * @returns {Observable}
 */
export default function EMEManager(mediaElement, keySystemsConfigs) {
    if (false) {
        keySystemsConfigs.forEach(function (config) { return assertInterface(config, {
            getLicense: "function",
            type: "string",
        }, "keySystem"); });
    }
    // Keep track of all initialization data handled here.
    // This is to avoid handling multiple times the same encrypted events.
    var handledInitData = new InitDataStore();
    /* Catch "encrypted" event and create MediaKeys */
    return observableCombineLatest(onEncrypted$(mediaElement), getMediaKeysInfos(mediaElement, keySystemsConfigs, attachedMediaKeysInfos)).pipe(
    /* Attach server certificate and create/reuse MediaKeySession */
    mergeMap(function (_a, i) {
        var encryptedEvent = _a[0], mediaKeysInfos = _a[1];
        log.debug("EME: encrypted event received", encryptedEvent);
        var keySystemOptions = mediaKeysInfos.keySystemOptions, mediaKeys = mediaKeysInfos.mediaKeys;
        var serverCertificate = keySystemOptions.serverCertificate;
        var session$ = getSession(encryptedEvent, handledInitData, mediaKeysInfos)
            .pipe(map(function (evt) { return ({
            type: evt.type,
            value: {
                initData: evt.value.initData,
                initDataType: evt.value.initDataType,
                mediaKeySession: evt.value.mediaKeySession,
                sessionType: evt.value.sessionType,
                keySystemOptions: mediaKeysInfos.keySystemOptions,
                sessionStorage: mediaKeysInfos.sessionStorage,
            },
        }); }));
        if (i === 0) { // first encrypted event for the current content
            return observableMerge(serverCertificate != null ?
                observableConcat(setServerCertificate(mediaKeys, serverCertificate), session$) : session$, attachMediaKeys(mediaKeysInfos, mediaElement, attachedMediaKeysInfos)
                .pipe(ignoreElements()));
        }
        return session$;
    }), 
    /* Trigger license request and manage MediaKeySession events */
    mergeMap(function (sessionInfosEvt) {
        if (sessionInfosEvt.type === "warning") {
            return observableOf(sessionInfosEvt);
        }
        var _a = sessionInfosEvt.value, initData = _a.initData, initDataType = _a.initDataType, mediaKeySession = _a.mediaKeySession, sessionType = _a.sessionType, keySystemOptions = _a.keySystemOptions, sessionStorage = _a.sessionStorage;
        return observableMerge(handleSessionEvents(mediaKeySession, keySystemOptions), 
        // only perform generate request on new sessions
        sessionInfosEvt.type === "created-session" ?
            generateKeyRequest(mediaKeySession, initData, initDataType).pipe(tap(function () {
                if (sessionType === "persistent-license" && sessionStorage != null) {
                    sessionStorage.add(initData, initDataType, mediaKeySession);
                }
            }), catchError(function (error) {
                throw new EncryptedMediaError("KEY_GENERATE_REQUEST_ERROR", error, false);
            }), ignoreElements()) : EMPTY).pipe(filter(function (sessionEvent) {
            return sessionEvent.type === "warning";
        }));
    }));
}
/**
 * Free up all ressources taken by the EME management.
 */
function disposeEME(mediaElement) {
    disposeMediaKeys(mediaElement, attachedMediaKeysInfos).subscribe(noop);
}
/**
 * Returns the name of the current key system used.
 * @returns {string}
 */
function getCurrentKeySystem(mediaElement) {
    var currentState = attachedMediaKeysInfos.getState(mediaElement);
    return currentState && currentState.keySystemOptions.type;
}
export { clearEMESession, disposeEME, getCurrentKeySystem, };
