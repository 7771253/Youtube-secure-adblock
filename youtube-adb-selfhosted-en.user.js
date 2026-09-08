// ==UserScript==
// @name         youtube-adb (self-hosted)
// @namespace    https://github.com/7771253/Youtube-secure-adblock
// @version      6.21.2
// @description  A script to remove YouTube ads, including static ads and video ads, without interfering with the network and ensuring safety. Self-hosted update source.
// @author       7771253
// @match        *://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @exclude      *://www.youtube.com/live_chat_replay*
// @exclude      *://www.youtube.com/persist_identity*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=YouTube.com
// @grant        none
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/7771253/Youtube-secure-adblock/main/youtube-adb-selfhosted-en.user.js
// @downloadURL  https://raw.githubusercontent.com/7771253/Youtube-secure-adblock/main/youtube-adb-selfhosted-en.user.js
// @supportURL   https://github.com/7771253/Youtube-secure-adblock/issues
// ==/UserScript==

(function () {
    'use strict';

    let video;

    // UI ad selectors
    const cssSelectorArr = [
        '#masthead-ad',                                                                                  // Homepage top banner ad
        'ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer)',   // Homepage in-feed ad
        '.video-ads.ytp-ad-module',                                                                      // Player bottom-bar ad
        'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',                                              // Watch-page membership promo dialog
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',                  // Watch-page top-right recommendation ad
        '#related #player-ads',                                                                          // Watch-page sidebar promo ad
        '#related ytd-ad-slot-renderer',                                                                 // Watch-page sidebar in-feed ad
        'ytd-ad-slot-renderer',                                                                           // Search results page ad
        'yt-mealbar-promo-renderer',                                                                     // Watch-page membership recommendation ad
        'ytd-popup-container:has(a[href="/premium"])',                                                    // Membership-upsell interstitial
        'ad-slot-renderer',                                                                               // Mobile web third-party recommendation ad
        'ytm-companion-ad-renderer',                                                                      // Mobile web skippable-ad link container
    ];

    window.dev = true; // set true for console debug logging

    /** Format a Date as 'YYYY-MM-DD HH:mm:ss' */
    function moment(time) {
        const y = time.getFullYear();
        const m = (time.getMonth() + 1).toString().padStart(2, '0');
        const d = time.getDate().toString().padStart(2, '0');
        const h = time.getHours().toString().padStart(2, '0');
        const min = time.getMinutes().toString().padStart(2, '0');
        const s = time.getSeconds().toString().padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }

    function log(msg) {
        if (!window.dev) return false;
        console.log(window.location.href);
        console.log(`${moment(new Date())}  ${msg}`);
    }

    function setRunFlag(name) {
        const style = document.createElement('style');
        style.id = name;
        (document.head || document.body).appendChild(style);
    }

    function getRunFlag(name) {
        return document.getElementById(name);
    }

    function checkRunFlag(name) {
        if (getRunFlag(name)) {
            return true;
        }
        setRunFlag(name);
        return false;
    }

    function generateRemoveADCssText(selectors) {
        const hideRules = selectors.map((selector) => `${selector}{display:none!important}`).join(' ');
        // Instantly hide the video element itself the moment YouTube marks the player as
        // showing an ad, so nothing is visually rendered even before skipAd() reacts.
        // This is a pure-CSS backstop against any timing gap in the JS-based skip logic.
        const instantHideRule =
            '.html5-video-player.ad-showing .html5-main-video{visibility:hidden!important;filter:brightness(0)!important}';
        return `${hideRules} ${instantHideRule}`;
    }

    function generateRemoveADHTMLElement(id) {
        if (checkRunFlag(id)) {
            log('Ad-hiding style node already generated');
            return false;
        }
        const style = document.createElement('style');
        (document.head || document.body).appendChild(style);
        style.appendChild(document.createTextNode(generateRemoveADCssText(cssSelectorArr)));
        log('Successfully generated ad-hiding style node');
    }

    function nativeTouch() {
        const touch = new Touch({
            identifier: Date.now(),
            target: this,
            clientX: 12,
            clientY: 34,
            radiusX: 56,
            radiusY: 78,
            rotationAngle: 0,
            force: 1,
        });

        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            cancelable: true,
            view: window,
            touches: [touch],
            targetTouches: [touch],
            changedTouches: [touch],
        });
        this.dispatchEvent(touchStartEvent);

        const touchEndEvent = new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true,
            view: window,
            touches: [],
            targetTouches: [],
            changedTouches: [touch],
        });
        this.dispatchEvent(touchEndEvent);
    }

    function getVideoDom() {
        video = document.querySelector('.ad-showing video') || document.querySelector('video');
    }

    function playAfterAd() {
        if (video && video.paused && video.currentTime < 1) {
            video.play();
            log('Auto-resumed video playback');
        }
    }

    function closeOverlay() {
        // Remove the YouTube ad-blocker-detected popup
        const premiumContainers = [...document.querySelectorAll('ytd-popup-container')];
        const matchingContainers = premiumContainers.filter((container) =>
            container.querySelector('a[href="/premium"]')
        );

        if (matchingContainers.length > 0) {
            matchingContainers.forEach((container) => container.remove());
            log('Removed ad-blocker-detected popup');
        }

        // Close the dimmed background overlay behind that popup
        const backdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
        const targetBackdrop = Array.from(backdrops).find(
            (backdrop) => backdrop.style.zIndex === '2201'
        );
        if (targetBackdrop) {
            targetBackdrop.className = '';
            targetBackdrop.removeAttribute('opened');
            log('Closed background overlay');
        }
    }

    let lastSkipAttempt = 0; // throttle guard, ms timestamp of last skipAd() run

    function skipAd() {
        if (!video) return;

        // Throttle: the MutationObserver can fire dozens of times per second on YouTube's
        // busy DOM, and skipAd() doesn't need to run that often. Without this guard, every
        // observer tick re-clicks the skip button and re-checks currentTime, which can pile
        // up redundant work and contend with the ad node's own paint/removal.
        const now = Date.now();
        if (now - lastSkipAttempt < 150) return;
        lastSkipAttempt = now;

        const skipButton =
            document.querySelector('.ytp-ad-skip-button') ||
            document.querySelector('.ytp-skip-ad-button') ||
            document.querySelector('.ytp-ad-skip-button-modern');
        const shortAdMsg =
            document.querySelector('.video-ads.ytp-ad-module .ytp-ad-player-overlay') ||
            document.querySelector('.ytp-ad-button-icon');

        // Mute during ads (skip on mobile web, which has a muting bug)
        if ((skipButton || shortAdMsg) && window.location.href.indexOf('https://m.youtube.com/') === -1) {
            video.muted = true;
        }

        if (skipButton) {
            const delayTime = 0.5;
            if (video.currentTime > delayTime) {
                video.currentTime = video.duration; // force-finish the ad
                log('Skipped ad via fallback button on special account');
                return;
            }
            skipButton.click(); // desktop
            nativeTouch.call(skipButton); // mobile
            log('Skipped ad via button click');
        } else if (shortAdMsg) {
            video.currentTime = video.duration; // force-finish unskippable short ad
            log('Force-ended unskippable ad');
        }
    }

    function removePlayerAD(id) {
        if (checkRunFlag(id)) {
            log('Player ad-removal routine already running');
            return false;
        }

        // Watch the whole page for changes and react to in-player ads
        const targetNode = document.body;
        const config = { childList: true, subtree: true };
        const observer = new MutationObserver(() => {
            getVideoDom();
            closeOverlay();
            skipAd();
            playAfterAd();
        });
        observer.observe(targetNode, config);
        log('Player ad-removal routine started successfully');
    }

    function resumeVideo() {
        const videoelem = document.body.querySelector('video.html5-main-video');
        if (videoelem && videoelem.paused) {
            log('Resumed video');
            videoelem.play();
        }
    }

    function removePop(node) {
        const elpopup = node.querySelector(
            '.ytd-popup-container > .ytd-popup-container > .ytd-enforcement-message-view-model'
        );

        if (elpopup) {
            elpopup.parentNode.remove();
            log('Removed enforcement popup');
            const bdelems = document.getElementsByTagName('tp-yt-iron-overlay-backdrop');
            for (let x = (bdelems || []).length; x--; ) {
                bdelems[x].remove();
            }
            resumeVideo();
        }

        if (node.tagName && node.tagName.toLowerCase() === 'tp-yt-iron-overlay-backdrop') {
            node.remove();
            resumeVideo();
            log('Removed backdrop element');
        }
    }

    function main() {
        generateRemoveADHTMLElement('removeADHTMLElement'); // hide static/UI ads
        removePlayerAD('removePlayerAD'); // handle in-player video ads

        // Watch for YouTube's enforcement/anti-adblock popup and remove it
        const popupObserver = new MutationObserver((mutations) =>
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    Array.from(mutation.addedNodes)
                        .filter((node) => node.nodeType === 1)
                        .forEach((node) => removePop(node));
                }
            })
        );
        popupObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
        log('YouTube ad-removal script queued to run on DOMContentLoaded');
    } else {
        main();
        log('YouTube ad-removal script running immediately');
    }
})();
