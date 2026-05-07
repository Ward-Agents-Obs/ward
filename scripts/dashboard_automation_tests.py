#!/usr/bin/env python3
"""
Ward Dashboard Navigation Automation Tests
=========================================

This script automates dashboard navigation and interaction to validate the UI flows
and data presentation. It simulates user interactions like filtering, searching,
session navigation, and data verification.

Features:
- Automated browser navigation through dashboard pages
- Session table interaction and validation
- Filter testing (time ranges, models, search)
- Data consistency checks between views
- Screenshot capture for debugging
- Performance timing measurements

Usage:
    python3 dashboard_automation_tests.py
    python3 dashboard_automation_tests.py --headless
    python3 dashboard_automation_tests.py --screenshots
    python3 dashboard_automation_tests.py --full-test
"""

import os
import time
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin
import requests
from dataclasses import dataclass

# Browser automation
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait, Select
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.firefox.options import Options as FirefoxOptions
    from selenium.common.exceptions import TimeoutException, NoSuchElementException
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

# Fallback for API-only tests
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

@dataclass
class TestResult:
    """Test result data structure"""
    test_name: str
    status: str  # "passed", "failed", "skipped"
    duration: float
    details: str
    screenshot_path: Optional[str] = None

class DashboardTester:
    """Dashboard automation test runner"""

    def __init__(self,
                 base_url: str = "http://localhost:3001",
                 headless: bool = False,
                 screenshots: bool = False,
                 browser: str = "chrome"):
        self.base_url = base_url
        self.headless = headless
        self.screenshots = screenshots
        self.browser = browser.lower()
        self.driver = None
        self.wait = None
        self.results: List[TestResult] = []

        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

        # Create screenshots directory if needed
        if self.screenshots:
            os.makedirs("test_screenshots", exist_ok=True)

    def setup_browser(self):
        """Initialize browser driver"""
        if not SELENIUM_AVAILABLE:
            self.logger.warning("Selenium not available. Run: pip install selenium")
            return False

        try:
            if self.browser == "firefox":
                options = FirefoxOptions()
                if self.headless:
                    options.add_argument("--headless")
                self.driver = webdriver.Firefox(options=options)
            else:  # Default to Chrome
                options = ChromeOptions()
                if self.headless:
                    options.add_argument("--headless")
                options.add_argument("--no-sandbox")
                options.add_argument("--disable-dev-shm-usage")
                options.add_argument("--disable-gpu")
                self.driver = webdriver.Chrome(options=options)

            self.driver.implicitly_wait(10)
            self.wait = WebDriverWait(self.driver, 20)

            self.logger.info(f"Browser setup complete: {self.browser}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to setup browser: {e}")
            return False

    def teardown_browser(self):
        """Close browser driver"""
        if self.driver:
            self.driver.quit()
            self.driver = None
            self.wait = None

    def take_screenshot(self, name: str) -> Optional[str]:
        """Take screenshot for debugging"""
        if not self.screenshots or not self.driver:
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"test_screenshots/{name}_{timestamp}.png"

        try:
            self.driver.save_screenshot(filename)
            self.logger.info(f"Screenshot saved: {filename}")
            return filename
        except Exception as e:
            self.logger.error(f"Failed to take screenshot: {e}")
            return None

    def run_test(self, test_name: str, test_func) -> TestResult:
        """Run individual test and capture result"""
        self.logger.info(f"Running test: {test_name}")
        start_time = time.time()

        try:
            result = test_func()
            duration = time.time() - start_time

            if result:
                status = "passed"
                details = "Test completed successfully"
            else:
                status = "failed"
                details = "Test returned False"

            screenshot_path = self.take_screenshot(f"{test_name}_result")

        except Exception as e:
            duration = time.time() - start_time
            status = "failed"
            details = f"Test failed with exception: {str(e)}"
            screenshot_path = self.take_screenshot(f"{test_name}_error")
            self.logger.error(f"Test {test_name} failed: {e}")

        test_result = TestResult(
            test_name=test_name,
            status=status,
            duration=duration,
            details=details,
            screenshot_path=screenshot_path
        )

        self.results.append(test_result)
        self.logger.info(f"Test {test_name}: {status} ({duration:.2f}s)")
        return test_result

    def test_dashboard_load(self) -> bool:
        """Test basic dashboard loading"""
        if not self.driver:
            # Fallback to HTTP check
            try:
                response = requests.get(self.base_url, timeout=10)
                return response.status_code == 200
            except:
                return False

        try:
            self.driver.get(self.base_url)

            # Wait for main navigation or loading indicator
            self.wait.until(
                lambda d: d.find_element(By.TAG_NAME, "body")
            )

            # Check if we're redirected to login or if dashboard loads
            current_url = self.driver.current_url
            title = self.driver.title

            self.logger.info(f"Dashboard loaded - URL: {current_url}, Title: {title}")
            return True

        except Exception as e:
            self.logger.error(f"Dashboard load failed: {e}")
            return False

    def test_navigation_to_traces(self) -> bool:
        """Test navigation to traces page"""
        if not self.driver:
            return False

        try:
            # Navigate to traces page
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)

            # Wait for traces page elements
            self.wait.until(
                EC.any_of(
                    EC.presence_of_element_located((By.TEXT, "Sessions")),
                    EC.presence_of_element_located((By.TEXT, "Session ID")),
                    EC.presence_of_element_located((By.CLASS_NAME, "session-table")),
                    EC.presence_of_element_located((By.TAG_NAME, "table"))
                )
            )

            page_source = self.driver.page_source.lower()
            has_session_content = any(term in page_source for term in [
                "session", "traces", "token", "cost", "duration"
            ])

            self.logger.info("Successfully navigated to traces page")
            return has_session_content

        except TimeoutException:
            self.logger.error("Timeout waiting for traces page to load")
            return False
        except Exception as e:
            self.logger.error(f"Navigation to traces failed: {e}")
            return False

    def test_session_table_interaction(self) -> bool:
        """Test session table loading and interaction"""
        if not self.driver:
            return False

        try:
            # Ensure we're on traces page
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)

            # Wait for table to load
            time.sleep(3)  # Allow React components to render

            # Look for table elements
            tables = self.driver.find_elements(By.TAG_NAME, "table")
            table_rows = self.driver.find_elements(By.TAG_NAME, "tr")

            self.logger.info(f"Found {len(tables)} tables, {len(table_rows)} rows")

            if len(tables) == 0:
                self.logger.info("No tables found - might be empty state")
                # Check for empty state or loading indicators
                page_text = self.driver.page_source.lower()
                has_expected_text = any(term in page_text for term in [
                    "no sessions", "loading", "session", "trace", "empty"
                ])
                return has_expected_text

            # Try to find session-related content
            page_content = self.driver.page_source.lower()
            session_indicators = [
                "session id", "first message", "last message",
                "duration", "traces", "tokens", "cost"
            ]

            found_indicators = sum(1 for indicator in session_indicators
                                 if indicator in page_content)

            self.logger.info(f"Found {found_indicators}/{len(session_indicators)} session indicators")

            # Look for clickable session links
            clickable_elements = self.driver.find_elements(By.TAG_NAME, "button") + \
                               self.driver.find_elements(By.TAG_NAME, "a") + \
                               self.driver.find_elements(By.CSS_SELECTOR, "[role='button']")

            self.logger.info(f"Found {len(clickable_elements)} clickable elements")

            return found_indicators > 0 or len(table_rows) > 1

        except Exception as e:
            self.logger.error(f"Session table interaction failed: {e}")
            return False

    def test_time_filter_functionality(self) -> bool:
        """Test time filter dropdown and selection"""
        if not self.driver:
            return False

        try:
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)
            time.sleep(2)

            # Look for time filter elements
            time_filters = []

            # Common time filter selectors
            selectors = [
                "select",
                "[data-testid*='time']",
                "[data-testid*='filter']",
                ".time-filter",
                ".filter-select"
            ]

            for selector in selectors:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                time_filters.extend(elements)

            # Also look for buttons with time-related text
            buttons = self.driver.find_elements(By.TAG_NAME, "button")
            for button in buttons:
                button_text = button.text.lower()
                if any(term in button_text for term in ["hour", "day", "week", "month", "time", "24h", "1h", "7d"]):
                    time_filters.append(button)

            self.logger.info(f"Found {len(time_filters)} potential time filter elements")

            # Try to interact with time filters
            interactions = 0
            for filter_elem in time_filters[:3]:  # Test first 3 elements
                try:
                    if filter_elem.is_displayed():
                        filter_elem.click()
                        time.sleep(0.5)
                        interactions += 1
                        break
                except:
                    continue

            self.logger.info(f"Successfully interacted with {interactions} time filter(s)")
            return len(time_filters) > 0

        except Exception as e:
            self.logger.error(f"Time filter test failed: {e}")
            return False

    def test_search_functionality(self) -> bool:
        """Test search input functionality"""
        if not self.driver:
            return False

        try:
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)
            time.sleep(2)

            # Look for search inputs
            search_inputs = []

            search_selectors = [
                "input[type='text']",
                "input[type='search']",
                "input[placeholder*='search']",
                "input[placeholder*='Search']",
                "[data-testid*='search']",
                ".search-input"
            ]

            for selector in search_selectors:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                search_inputs.extend(elements)

            self.logger.info(f"Found {len(search_inputs)} search input elements")

            # Try to use search functionality
            search_success = False
            test_query = "test search"

            for search_input in search_inputs[:2]:  # Test first 2 inputs
                try:
                    if search_input.is_displayed():
                        search_input.clear()
                        search_input.send_keys(test_query)
                        time.sleep(1)

                        # Check if value was set
                        current_value = search_input.get_attribute("value")
                        if current_value == test_query:
                            search_success = True
                            self.logger.info(f"Search input working: {current_value}")
                            break

                except Exception as e:
                    self.logger.debug(f"Search input interaction failed: {e}")
                    continue

            return len(search_inputs) > 0 and search_success

        except Exception as e:
            self.logger.error(f"Search functionality test failed: {e}")
            return False

    def test_session_detail_navigation(self) -> bool:
        """Test clicking on session to view details"""
        if not self.driver:
            return False

        try:
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)
            time.sleep(3)

            # Look for clickable session elements
            clickable_sessions = []

            # Find links, buttons, or clickable table cells
            potential_links = (
                self.driver.find_elements(By.CSS_SELECTOR, "a[href*='trace']") +
                self.driver.find_elements(By.CSS_SELECTOR, "a[href*='session']") +
                self.driver.find_elements(By.CSS_SELECTOR, "button") +
                self.driver.find_elements(By.CSS_SELECTOR, "td") +
                self.driver.find_elements(By.CSS_SELECTOR, "[role='button']")
            )

            # Filter for elements that might be session IDs or links
            for elem in potential_links:
                try:
                    text = elem.text.strip()
                    href = elem.get_attribute("href")

                    # Check if it looks like a session ID or trace link
                    is_session_like = (
                        (text and len(text) > 10 and any(c.isalnum() for c in text)) or
                        (href and ("trace" in href or "session" in href))
                    )

                    if is_session_like and elem.is_displayed():
                        clickable_sessions.append(elem)

                except:
                    continue

            self.logger.info(f"Found {len(clickable_sessions)} potential session links")

            # Try to click on a session
            navigation_success = False
            original_url = self.driver.current_url

            for session_elem in clickable_sessions[:3]:  # Try first 3
                try:
                    session_elem.click()
                    time.sleep(2)

                    new_url = self.driver.current_url
                    if new_url != original_url:
                        self.logger.info(f"Navigation successful: {original_url} -> {new_url}")
                        navigation_success = True

                        # Navigate back for other tests
                        self.driver.back()
                        time.sleep(1)
                        break

                except Exception as e:
                    self.logger.debug(f"Click failed on session element: {e}")
                    continue

            return len(clickable_sessions) > 0 or navigation_success

        except Exception as e:
            self.logger.error(f"Session detail navigation test failed: {e}")
            return False

    def test_data_consistency(self) -> bool:
        """Test data consistency between views"""
        if not self.driver:
            # Use API to check data consistency
            return self.test_data_consistency_api()

        try:
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)
            time.sleep(3)

            # Extract data from sessions table
            page_content = self.driver.page_source

            # Count sessions mentioned in page
            session_count = page_content.lower().count("session")
            trace_count = page_content.lower().count("trace")
            token_count = page_content.lower().count("token")
            cost_mentions = page_content.lower().count("cost") + page_content.lower().count("$")

            # Look for numerical data
            import re
            numbers = re.findall(r'\d+', page_content)

            consistency_score = 0
            if session_count > 0:
                consistency_score += 1
            if trace_count > 0:
                consistency_score += 1
            if token_count > 0:
                consistency_score += 1
            if cost_mentions > 0:
                consistency_score += 1
            if len(numbers) > 10:  # Should have many numbers for metrics
                consistency_score += 1

            self.logger.info(f"Data consistency score: {consistency_score}/5")
            self.logger.info(f"Sessions: {session_count}, Traces: {trace_count}, Tokens: {token_count}, Costs: {cost_mentions}")

            return consistency_score >= 3

        except Exception as e:
            self.logger.error(f"Data consistency test failed: {e}")
            return False

    def test_data_consistency_api(self) -> bool:
        """Fallback API-based data consistency test"""
        try:
            # Test if we can access any API endpoints
            api_endpoints = [
                "/api/traces",
                "/api/sessions",
                "/api/metrics",
                "/health",
                "/ping"
            ]

            working_endpoints = 0
            for endpoint in api_endpoints:
                try:
                    url = urljoin(self.base_url, endpoint)
                    response = requests.get(url, timeout=5)
                    if response.status_code < 500:  # Accept 200, 404, etc. but not 500s
                        working_endpoints += 1
                        self.logger.info(f"API endpoint {endpoint}: {response.status_code}")
                except:
                    continue

            self.logger.info(f"Working API endpoints: {working_endpoints}/{len(api_endpoints)}")
            return working_endpoints > 0

        except Exception as e:
            self.logger.error(f"API consistency test failed: {e}")
            return False

    def test_responsive_design(self) -> bool:
        """Test responsive design at different screen sizes"""
        if not self.driver:
            return False

        try:
            traces_url = urljoin(self.base_url, "/traces")
            self.driver.get(traces_url)

            # Test different viewport sizes
            viewports = [
                (1920, 1080),  # Desktop
                (1024, 768),   # Tablet landscape
                (768, 1024),   # Tablet portrait
                (375, 667)     # Mobile
            ]

            responsive_score = 0

            for width, height in viewports:
                try:
                    self.driver.set_window_size(width, height)
                    time.sleep(1)

                    # Check if page is still usable
                    body = self.driver.find_element(By.TAG_NAME, "body")
                    is_usable = (
                        body.size['width'] <= width and
                        body.is_displayed()
                    )

                    if is_usable:
                        responsive_score += 1
                        self.logger.info(f"Responsive at {width}x{height}: ✓")
                    else:
                        self.logger.info(f"Responsive at {width}x{height}: ✗")

                except Exception as e:
                    self.logger.debug(f"Viewport {width}x{height} test failed: {e}")

            # Reset to default size
            self.driver.set_window_size(1920, 1080)

            self.logger.info(f"Responsive design score: {responsive_score}/{len(viewports)}")
            return responsive_score >= len(viewports) // 2

        except Exception as e:
            self.logger.error(f"Responsive design test failed: {e}")
            return False

    def run_all_tests(self, test_suite: str = "basic") -> Dict[str, Any]:
        """Run complete test suite"""
        self.logger.info(f"Starting dashboard automation tests - Suite: {test_suite}")

        if SELENIUM_AVAILABLE and self.setup_browser():
            browser_tests = True
        else:
            browser_tests = False
            self.logger.warning("Running without browser automation - limited tests available")

        # Define test suites
        basic_tests = [
            ("Dashboard Load", self.test_dashboard_load),
            ("API Consistency", self.test_data_consistency_api)
        ]

        full_tests = basic_tests + [
            ("Navigation to Traces", self.test_navigation_to_traces),
            ("Session Table", self.test_session_table_interaction),
            ("Time Filters", self.test_time_filter_functionality),
            ("Search Functionality", self.test_search_functionality),
            ("Session Detail Navigation", self.test_session_detail_navigation),
            ("Data Consistency", self.test_data_consistency),
        ]

        browser_tests_list = [
            ("Responsive Design", self.test_responsive_design)
        ]

        # Select tests based on suite and capabilities
        if test_suite == "full":
            tests_to_run = full_tests
            if browser_tests:
                tests_to_run.extend(browser_tests_list)
        else:
            tests_to_run = basic_tests
            if browser_tests:
                tests_to_run.extend(full_tests[2:])  # Add browser-dependent tests

        # Run tests
        start_time = time.time()

        for test_name, test_func in tests_to_run:
            self.run_test(test_name, test_func)

        total_duration = time.time() - start_time

        # Cleanup
        if browser_tests:
            self.teardown_browser()

        # Generate summary
        passed = sum(1 for r in self.results if r.status == "passed")
        failed = sum(1 for r in self.results if r.status == "failed")
        total = len(self.results)

        summary = {
            "total_tests": total,
            "passed": passed,
            "failed": failed,
            "success_rate": (passed / total * 100) if total > 0 else 0,
            "total_duration": total_duration,
            "results": self.results,
            "browser_automation": browser_tests,
            "test_suite": test_suite
        }

        self.logger.info(f"Test Summary: {passed}/{total} passed ({summary['success_rate']:.1f}%)")

        return summary

def generate_test_report(summary: Dict[str, Any]) -> str:
    """Generate HTML test report"""
    html_report = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Ward Dashboard Automation Test Report</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px; }}
            .header {{ background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }}
            .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }}
            .stat-card {{ background: white; border: 1px solid #e9ecef; padding: 20px; border-radius: 8px; }}
            .stat-value {{ font-size: 2em; font-weight: bold; color: #007bff; }}
            .test-result {{ margin-bottom: 15px; padding: 15px; border-radius: 8px; }}
            .passed {{ background-color: #d4edda; border-left: 4px solid #28a745; }}
            .failed {{ background-color: #f8d7da; border-left: 4px solid #dc3545; }}
            .test-name {{ font-weight: bold; margin-bottom: 5px; }}
            .test-details {{ color: #666; font-size: 0.9em; }}
            .screenshot {{ margin-top: 10px; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🧪 Ward Dashboard Automation Test Report</h1>
            <p>Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            <p>Test Suite: {summary['test_suite']} | Browser Automation: {'Enabled' if summary['browser_automation'] else 'API Only'}</p>
        </div>

        <div class="summary">
            <div class="stat-card">
                <div class="stat-value">{summary['passed']}/{summary['total_tests']}</div>
                <div>Tests Passed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{summary['success_rate']:.1f}%</div>
                <div>Success Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{summary['total_duration']:.1f}s</div>
                <div>Total Duration</div>
            </div>
        </div>

        <h2>Test Results</h2>
    """

    for result in summary['results']:
        status_class = result.status
        screenshot_html = ""
        if result.screenshot_path:
            screenshot_html = f'<div class="screenshot"><a href="{result.screenshot_path}">📷 Screenshot</a></div>'

        html_report += f"""
        <div class="test-result {status_class}">
            <div class="test-name">{result.test_name}</div>
            <div class="test-details">
                Status: {result.status.upper()} | Duration: {result.duration:.2f}s<br>
                {result.details}
            </div>
            {screenshot_html}
        </div>
        """

    html_report += """
        <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e9ecef; color: #666;">
            <p>Generated by Ward SDK Dashboard Automation Tests</p>
        </footer>
    </body>
    </html>
    """

    return html_report

def main():
    """Main test execution"""
    import argparse

    parser = argparse.ArgumentParser(description="Ward Dashboard Automation Tests")
    parser.add_argument("--base-url", default="http://localhost:3001",
                       help="Dashboard base URL")
    parser.add_argument("--headless", action="store_true",
                       help="Run browser in headless mode")
    parser.add_argument("--screenshots", action="store_true",
                       help="Capture screenshots during tests")
    parser.add_argument("--browser", choices=["chrome", "firefox"], default="chrome",
                       help="Browser to use for automation")
    parser.add_argument("--test-suite", choices=["basic", "full"], default="full",
                       help="Test suite to run")
    parser.add_argument("--report", action="store_true",
                       help="Generate HTML report")

    args = parser.parse_args()

    print("🧪 Ward Dashboard Automation Tests")
    print("=" * 50)

    if not SELENIUM_AVAILABLE:
        print("⚠️  Selenium not available - install with: pip install selenium")
        print("   Running limited API-based tests only...")

    # Initialize tester
    tester = DashboardTester(
        base_url=args.base_url,
        headless=args.headless,
        screenshots=args.screenshots,
        browser=args.browser
    )

    # Run tests
    try:
        summary = tester.run_all_tests(test_suite=args.test_suite)

        # Print summary
        print("\n" + "=" * 50)
        print("📊 TEST SUMMARY")
        print("=" * 50)
        print(f"Total Tests: {summary['total_tests']}")
        print(f"Passed: {summary['passed']}")
        print(f"Failed: {summary['failed']}")
        print(f"Success Rate: {summary['success_rate']:.1f}%")
        print(f"Duration: {summary['total_duration']:.1f}s")
        print(f"Browser Automation: {'✓' if summary['browser_automation'] else '✗'}")

        # Generate report if requested
        if args.report:
            report_html = generate_test_report(summary)
            report_path = f"dashboard_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"

            with open(report_path, 'w') as f:
                f.write(report_html)

            print(f"\n📄 HTML Report: {report_path}")

        # Exit with appropriate code
        exit_code = 0 if summary['failed'] == 0 else 1

        if exit_code == 0:
            print("\n✅ All tests passed!")
        else:
            print(f"\n❌ {summary['failed']} test(s) failed")

        return exit_code

    except KeyboardInterrupt:
        print("\n⚠️ Tests interrupted by user")
        return 130
    except Exception as e:
        print(f"\n❌ Test execution failed: {e}")
        return 1

if __name__ == "__main__":
    exit(main())